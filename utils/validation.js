// utils/validation.js
const validateEthereumAddress = (address) => {
    // Basic Ethereum address validation (checks if it's a valid format)
    if (!address) return true; // Allow empty addresses
    
    // Check if it has the basic format of an Ethereum address
    // (0x followed by 40 hexadecimal characters)
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };
  
  // For other blockchain addresses, you can add specific validation functions
  // For example, Bitcoin, Solana, etc.
  
  module.exports = {
    validateEthereumAddress
  };