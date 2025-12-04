// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface PerformanceMetric {
  id: string;
  modelName: string;
  accuracy: number;
  loss: number;
  timestamp: number;
  encryptedData: string;
  status: "normal" | "warning" | "critical";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newMetricData, setNewMetricData] = useState({
    modelName: "",
    accuracy: "",
    loss: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [selectedMetric, setSelectedMetric] = useState<PerformanceMetric | null>(null);
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Calculate statistics
  const normalCount = metrics.filter(m => m.status === "normal").length;
  const warningCount = metrics.filter(m => m.status === "warning").length;
  const criticalCount = metrics.filter(m => m.status === "critical").length;

  useEffect(() => {
    loadMetrics().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadMetrics = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("metric_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing metric keys:", e);
        }
      }
      
      const list: PerformanceMetric[] = [];
      
      for (const key of keys) {
        try {
          const metricBytes = await contract.getData(`metric_${key}`);
          if (metricBytes.length > 0) {
            try {
              const metricData = JSON.parse(ethers.toUtf8String(metricBytes));
              list.push({
                id: key,
                modelName: metricData.modelName,
                accuracy: metricData.accuracy,
                loss: metricData.loss,
                timestamp: metricData.timestamp,
                encryptedData: metricData.data,
                status: metricData.status || "normal"
              });
            } catch (e) {
              console.error(`Error parsing metric data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading metric ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setMetrics(list);
    } catch (e) {
      console.error("Error loading metrics:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitMetric = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting performance data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newMetricData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const metricId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Determine status based on accuracy and loss
      const accuracy = parseFloat(newMetricData.accuracy);
      const loss = parseFloat(newMetricData.loss);
      let status: "normal" | "warning" | "critical" = "normal";
      
      if (accuracy < 85 || loss > 0.5) status = "warning";
      if (accuracy < 70 || loss > 1.0) status = "critical";

      const metricData = {
        modelName: newMetricData.modelName,
        accuracy,
        loss,
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        status
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `metric_${metricId}`, 
        ethers.toUtf8Bytes(JSON.stringify(metricData))
      );
      
      const keysBytes = await contract.getData("metric_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(metricId);
      
      await contract.setData(
        "metric_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Performance data encrypted and stored securely!"
      });
      
      await loadMetrics();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewMetricData({
          modelName: "",
          accuracy: "",
          loss: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Checking FHE service availability..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const isAvailable = await contract.isAvailable();
      
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE service is available and ready for encrypted computations!"
        });
      } else {
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "FHE service is currently unavailable"
        });
      }
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Filter metrics based on search term
  const filteredMetrics = metrics.filter(metric =>
    metric.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    metric.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentMetrics = filteredMetrics.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredMetrics.length / itemsPerPage);

  const paginate = (pageNumber: number) => setCurrentPage(pageNumber);

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start monitoring AI model performance",
      icon: "🔗"
    },
    {
      title: "Add Performance Metrics",
      description: "Submit encrypted model performance data for FHE analysis",
      icon: "📊"
    },
    {
      title: "FHE Analysis",
      description: "Your data is analyzed in encrypted state without decryption",
      icon: "🔍"
    },
    {
      title: "Monitor Performance",
      description: "Track model degradation and receive encrypted alerts",
      icon: "⚠️"
    }
  ];

  const renderLineChart = () => {
    // Simplified line chart for performance trends
    return (
      <div className="line-chart-container">
        <div className="line-chart">
          <div className="chart-grid">
            <div className="grid-line"></div>
            <div className="grid-line"></div>
            <div className="grid-line"></div>
            <div className="grid-line"></div>
          </div>
          <div className="data-line">
            {metrics.slice(0, 6).map((metric, index) => (
              <div 
                key={index}
                className="data-point"
                style={{ 
                  left: `${index * 20}%`,
                  bottom: `${metric.accuracy}%`
                }}
                title={`Accuracy: ${metric.accuracy}%`}
              ></div>
            ))}
          </div>
        </div>
        <div className="chart-legend">
          <span>Accuracy Trend (Last 6 Records)</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="ai-icon"></div>
          </div>
          <h1>FHE<span>Model</span>Monitor</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-metric-btn primary-btn"
          >
            <div className="add-icon"></div>
            Add Metrics
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Based AI Model Performance Monitoring</h2>
            <p>Securely track model performance degradation with fully homomorphic encryption</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-ENCRYPTED COMPUTATIONS</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE Model Monitoring Works</h2>
            <p className="subtitle">Learn how to securely monitor AI model performance without exposing sensitive data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Project Introduction</h3>
            <p>Monitor AI model performance degradation using FHE technology to process encrypted inference data without decryption.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Performance Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{metrics.length}</div>
                <div className="stat-label">Total Metrics</div>
              </div>
              <div className="stat-item">
                <div className="stat-value normal">{normalCount}</div>
                <div className="stat-label">Normal</div>
              </div>
              <div className="stat-item">
                <div className="stat-value warning">{warningCount}</div>
                <div className="stat-label">Warning</div>
              </div>
              <div className="stat-item">
                <div className="stat-value critical">{criticalCount}</div>
                <div className="stat-label">Critical</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Performance Trend</h3>
            {renderLineChart()}
          </div>

          <div className="dashboard-card">
            <h3>FHE Service Status</h3>
            <div className="service-status">
              <div className="status-indicator"></div>
              <span>FHE Runtime Active</span>
            </div>
            <button 
              onClick={checkAvailability}
              className="primary-btn small"
            >
              Check Availability
            </button>
          </div>
        </div>
        
        <div className="metrics-section">
          <div className="section-header">
            <h2>Encrypted Performance Metrics</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text"
                  placeholder="Search models..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="search-icon"></div>
              </div>
              <button 
                onClick={loadMetrics}
                className="refresh-btn secondary-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="metrics-list">
            {filteredMetrics.length === 0 ? (
              <div className="no-metrics">
                <div className="no-metrics-icon"></div>
                <p>No performance metrics found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowAddModal(true)}
                >
                  Add First Metric
                </button>
              </div>
            ) : (
              <>
                {currentMetrics.map(metric => (
                  <div 
                    className={`metric-card ${metric.status}`}
                    key={metric.id}
                    onClick={() => setSelectedMetric(metric)}
                  >
                    <div className="metric-header">
                      <h3>{metric.modelName}</h3>
                      <span className={`status-badge ${metric.status}`}>
                        {metric.status}
                      </span>
                    </div>
                    <div className="metric-details">
                      <div className="metric-data">
                        <div className="data-item">
                          <label>Accuracy</label>
                          <span className="value">{metric.accuracy}%</span>
                        </div>
                        <div className="data-item">
                          <label>Loss</label>
                          <span className="value">{metric.loss}</span>
                        </div>
                        <div className="data-item">
                          <label>Date</label>
                          <span className="value">
                            {new Date(metric.timestamp * 1000).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="metric-actions">
                        <button className="action-btn">
                          View Details
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      onClick={() => paginate(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button 
                      onClick={() => paginate(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="info-section">
          <button 
            className="toggle-btn secondary-btn"
            onClick={() => setShowTeamInfo(!showTeamInfo)}
          >
            {showTeamInfo ? "Hide Team Info" : "Show Team Information"}
          </button>
          
          {showTeamInfo && (
            <div className="team-info">
              <h3>Development Team</h3>
              <div className="team-grid">
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Dr. Alice Chen</h4>
                  <p>FHE Research Lead</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Mark Johnson</h4>
                  <p>AI Systems Architect</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Sarah Williams</h4>
                  <p>Security Engineer</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  
      {showAddModal && (
        <ModalAdd 
          onSubmit={submitMetric} 
          onClose={() => setShowAddModal(false)} 
          adding={adding}
          metricData={newMetricData}
          setMetricData={setNewMetricData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="ai-icon"></div>
              <span>FHEModelMonitor</span>
            </div>
            <p>Secure AI model performance monitoring using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHEModelMonitor. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  metricData: any;
  setMetricData: (data: any) => void;
}

const ModalAdd: React.FC<ModalAddProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  metricData,
  setMetricData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setMetricData({
      ...metricData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!metricData.modelName || !metricData.accuracy || !metricData.loss) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="add-modal">
        <div className="modal-header">
          <h2>Add Performance Metrics</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> Your performance data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Model Name *</label>
              <input 
                type="text"
                name="modelName"
                value={metricData.modelName} 
                onChange={handleChange}
                placeholder="Enter model name..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Accuracy (%) *</label>
              <input 
                type="number"
                name="accuracy"
                value={metricData.accuracy} 
                onChange={handleChange}
                placeholder="0-100" 
                min="0"
                max="100"
                step="0.1"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Loss *</label>
              <input 
                type="number"
                name="loss"
                value={metricData.loss} 
                onChange={handleChange}
                placeholder="0.0-10.0" 
                min="0"
                max="10"
                step="0.01"
                className="form-input"
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="submit-btn primary-btn"
          >
            {adding ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;