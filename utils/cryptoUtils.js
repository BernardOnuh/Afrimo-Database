const Web3 = require('web3');
const crypto = require('crypto');

// USDT (ERC-20) ABI for token transfers
const USDT_ABI = [
  {
    "constant": true,
    "inputs": [],
    "name": "name",
    "outputs": [{"name": "", "type": "string"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "symbol",
    "outputs": [{"name": "", "type": "string"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}, {"name": "_spender", "type": "address"}],
    "name": "allowance",
    "outputs": [{"name": "", "type": "uint256"}],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{"name": "_spender", "type": "address"}, {"name": "_value", "type": "uint256"}],
    "name": "approve",
    "outputs": [{"name": "", "type": "bool"}],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{"name": "_from", "type": "address"}, {"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
    "name": "transferFrom",
    "outputs": [{"name": "", "type": "bool"}],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": true, "name": "_from", "type": "address"}, {"indexed": true, "name": "_to", "type": "address"}, {"indexed": false, "name": "_value", "type": "uint256"}],
    "name": "Transfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [{"indexed": true, "name": "_owner", "type": "address"}, {"indexed": true, "name": "_spender", "type": "address"}, {"indexed": false, "name": "_value", "type": "uint256"}],
    "name": "Approval",
    "type": "event"
  }
];

// Ethereum network configuration
const NETWORKS = {
  ethereum: {
    rpcUrl: process.env.ETH_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
    chainId: 1,
    name: 'Ethereum Mainnet',
    usdtAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT on Ethereum
  },
  bsc: {
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    chainId: 56,
    name: 'Binance Smart Chain',
    usdtAddress: '0x55d398326f99059fF775485246999027B3197955' // USDT (BSC) / BUSD
  },
  polygon: {
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    chainId: 137,
    name: 'Polygon Mainnet',
    usdtAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' // USDT on Polygon
  }
};

// Initialize Web3 with default provider
const getWeb3 = (network = 'ethereum') => {
  const networkConfig = NETWORKS[network] || NETWORKS.ethereum;
  return new Web3(new Web3.providers.HttpProvider(networkConfig.rpcUrl));
};

// Basic Ethereum address validation
const isValidEthAddress = (address) => {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
};

// Generate wallet nonce for authentication
const generateWalletNonce = (walletAddress) => {
  // Create a random nonce
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Create a timestamp (valid for 1 hour)
  const timestamp = Date.now() + 3600000; // 1 hour
  
  // Return the nonce details
  return {
    nonce,
    timestamp,
    message: `Sign this message to authenticate with AfriMobile: ${nonce}`
  };
};

// Verify USDT transaction (this is a helper function for admin verification)
const verifyUSDTTransaction = async (txHash, expectedAmount, recipientAddress, network = 'ethereum') => {
  try {
    const web3 = getWeb3(network);
    const networkConfig = NETWORKS[network] || NETWORKS.ethereum;
    
    // Get transaction details
    const tx = await web3.eth.getTransaction(txHash);
    if (!tx) {
      return { success: false, message: 'Transaction not found' };
    }
    
    // Get transaction receipt to check status
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (!receipt || !receipt.status) {
      return { success: false, message: 'Transaction failed or pending' };
    }
    
    // Initialize USDT contract
    const usdtContract = new web3.eth.Contract(USDT_ABI, networkConfig.usdtAddress);
    
    // Get decimals for USDT
    const decimals = await usdtContract.methods.decimals().call();
    const divisor = 10 ** decimals;
    
    // Get transfer events from the transaction
    const events = await usdtContract.getPastEvents('Transfer', {
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      filter: {
        _to: recipientAddress
      }
    });
    
    // Find matching transfer events
    let transferFound = false;
    let transferAmount = 0;
    
    for (const event of events) {
      if (event.transactionHash === txHash) {
        transferFound = true;
        transferAmount += parseInt(event.returnValues._value) / divisor;
      }
    }
    
    if (!transferFound) {
      return { 
        success: false, 
        message: 'No USDT transfer to the specified recipient found in this transaction' 
      };
    }
    
    // Check if amount matches (with a small tolerance for rounding)
    const amountMatches = Math.abs(transferAmount - expectedAmount) < 0.01;
    
    return {
      success: true,
      verified: amountMatches,
      actualAmount: transferAmount,
      expectedAmount,
      message: amountMatches 
        ? 'Transaction verified successfully' 
        : `Amount mismatch: expected ${expectedAmount} USDT, got ${transferAmount} USDT`
    };
  } catch (error) {
    console.error('Error verifying USDT transaction:', error);
    return {
      success: false,
      message: `Error verifying transaction: ${error.message}`
    };
  }
};

module.exports = {
  getWeb3,
  isValidEthAddress,
  generateWalletNonce,
  verifyUSDTTransaction,
  NETWORKS
};