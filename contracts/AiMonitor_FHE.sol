// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AiMonitor_FHE is SepoliaConfig {
    struct EncryptedPrediction {
        uint256 id;
        euint32 encryptedInput;       // Encrypted model input
        euint32 encryptedPrediction;  // Encrypted model output
        euint32 encryptedGroundTruth; // Encrypted ground truth (if available)
        uint256 timestamp;
        string modelId;
    }

    struct PerformanceMetrics {
        euint32 encryptedAccuracy;
        euint32 encryptedDriftScore;
        euint32 encryptedErrorRate;
    }

    struct DecryptedAlert {
        uint32 performanceScore;
        string alertLevel;
        bool needsRetraining;
        bool isRevealed;
    }

    uint256 public predictionCount;
    mapping(uint256 => EncryptedPrediction) public predictions;
    mapping(string => PerformanceMetrics) public modelPerformance;
    mapping(uint256 => DecryptedAlert) public performanceAlerts;
    
    mapping(uint256 => uint256) private requestToPredictionId;
    mapping(uint256 => string) private requestToModelId;
    string[] private monitoredModels;

    event PredictionRecorded(uint256 indexed id, string modelId, uint256 timestamp);
    event PerformanceAnalysisRequested(uint256 indexed predictionId);
    event AlertGenerated(uint256 indexed predictionId);
    event PerformanceAlertDecrypted(uint256 indexed predictionId);

    modifier onlyModelOwner(string memory modelId) {
        _;
    }

    function recordEncryptedPrediction(
        string memory modelId,
        euint32 input,
        euint32 prediction,
        euint32 groundTruth
    ) public onlyModelOwner(modelId) {
        predictionCount += 1;
        uint256 newId = predictionCount;
        
        predictions[newId] = EncryptedPrediction({
            id: newId,
            encryptedInput: input,
            encryptedPrediction: prediction,
            encryptedGroundTruth: groundTruth,
            timestamp: block.timestamp,
            modelId: modelId
        });
        
        performanceAlerts[newId] = DecryptedAlert({
            performanceScore: 0,
            alertLevel: "",
            needsRetraining: false,
            isRevealed: false
        });

        if (!isModelMonitored(modelId)) {
            monitoredModels.push(modelId);
            modelPerformance[modelId] = PerformanceMetrics({
                encryptedAccuracy: FHE.asEuint32(0),
                encryptedDriftScore: FHE.asEuint32(0),
                encryptedErrorRate: FHE.asEuint32(0)
            });
        }
        
        emit PredictionRecorded(newId, modelId, block.timestamp);
    }

    function requestPerformanceAnalysis(uint256 predictionId) public onlyModelOwner(predictions[predictionId].modelId) {
        EncryptedPrediction storage pred = predictions[predictionId];
        require(!performanceAlerts[predictionId].isRevealed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(pred.encryptedInput);
        ciphertexts[1] = FHE.toBytes32(pred.encryptedPrediction);
        ciphertexts[2] = FHE.toBytes32(pred.encryptedGroundTruth);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.processPerformanceAnalysis.selector);
        requestToPredictionId[reqId] = predictionId;
        
        emit PerformanceAnalysisRequested(predictionId);
    }

    function processPerformanceAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 predictionId = requestToPredictionId[requestId];
        require(predictionId != 0, "Invalid request");
        
        DecryptedAlert storage alert = performanceAlerts[predictionId];
        require(!alert.isRevealed, "Already processed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 input, uint32 prediction, uint32 groundTruth) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
        
        alert.performanceScore = calculatePerformanceScore(input, prediction, groundTruth);
        alert.alertLevel = determineAlertLevel(alert.performanceScore);
        alert.needsRetraining = (alert.performanceScore < 60);
        alert.isRevealed = true;
        
        emit PerformanceAlertDecrypted(predictionId);
    }

    function updateModelMetrics(string memory modelId, euint32 accuracy, euint32 drift, euint32 errorRate) 
        public onlyModelOwner(modelId) 
    {
        PerformanceMetrics storage metrics = modelPerformance[modelId];
        metrics.encryptedAccuracy = FHE.add(metrics.encryptedAccuracy, accuracy);
        metrics.encryptedDriftScore = FHE.add(metrics.encryptedDriftScore, drift);
        metrics.encryptedErrorRate = FHE.add(metrics.encryptedErrorRate, errorRate);
    }

    function requestModelMetricsDecryption(string memory modelId) public onlyModelOwner(modelId) {
        PerformanceMetrics storage metrics = modelPerformance[modelId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(metrics.encryptedAccuracy);
        ciphertexts[1] = FHE.toBytes32(metrics.encryptedDriftScore);
        ciphertexts[2] = FHE.toBytes32(metrics.encryptedErrorRate);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptModelMetrics.selector);
        requestToModelId[reqId] = modelId;
    }

    function decryptModelMetrics(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        string memory modelId = requestToModelId[requestId];
        require(bytes(modelId).length > 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 accuracy, uint32 drift, uint32 errorRate) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
    }

    function getDecryptedAlert(uint256 predictionId) public view returns (
        uint32 score,
        string memory alert,
        bool retraining,
        bool isRevealed
    ) {
        DecryptedAlert storage a = performanceAlerts[predictionId];
        return (a.performanceScore, a.alertLevel, a.needsRetraining, a.isRevealed);
    }

    function calculatePerformanceScore(
        uint32 input,
        uint32 prediction,
        uint32 groundTruth
    ) private pure returns (uint32) {
        uint32 error = prediction > groundTruth ? prediction - groundTruth : groundTruth - prediction;
        return 100 - (error * 100 / (input > 0 ? input : 1));
    }

    function determineAlertLevel(uint32 score) private pure returns (string memory) {
        if (score < 50) return "Critical";
        if (score < 70) return "Warning";
        if (score < 85) return "Notice";
        return "Normal";
    }

    function isModelMonitored(string memory modelId) private view returns (bool) {
        for (uint i = 0; i < monitoredModels.length; i++) {
            if (keccak256(bytes(monitoredModels[i])) == keccak256(bytes(modelId))) {
                return true;
            }
        }
        return false;
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getModelFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < monitoredModels.length; i++) {
            if (bytes32ToUint(keccak256(bytes(monitoredModels[i]))) == hash) {
                return monitoredModels[i];
            }
        }
        revert("Model not found");
    }
}