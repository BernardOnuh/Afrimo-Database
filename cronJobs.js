const cron = require('node-cron');
const Withdrawal = require('./models/Withdrawal');
const ReferralTransaction = require('./models/ReferralTransaction');
const axios = require('axios');
const User = require('./models/User');
const { sendEmail } = require('./utils/emailService');
const { generateWithdrawalReceipt } = require('./utils/withdrawalReceiptService.js');

/**
 * Cron job to verify and update processing withdrawals
 * Runs every 2 minutes
 */
const verifyProcessingWithdrawals = cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('Running scheduled withdrawal status verification...');
    
    // Find all withdrawals in processing state
    const processingWithdrawals = await Withdrawal.find({
      status: 'processing'
    });
    
    console.log(`Found ${processingWithdrawals.length} processing withdrawals to verify`);
    
    let updatedCount = 0;
    
    // Process each withdrawal
    for (const withdrawal of processingWithdrawals) {
      try {
        // Use transaction-by-reference endpoint to get the latest status
        const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
          }
        });
        
        if (response.data && response.data.status) {
          const transactionData = response.data.data;
          let statusChanged = false;
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            statusChanged = true;
            
            // Create a transaction record for successful withdrawal only if not exists
            const existingTransaction = await ReferralTransaction.findOne({ reference: withdrawal.clientReference });
            if (!existingTransaction) {
              const transaction = new ReferralTransaction({
                user: withdrawal.user,
                type: 'withdrawal',
                amount: -withdrawal.amount,
                description: `Withdrawal to ${withdrawal.paymentDetails.bankName} - ${withdrawal.paymentDetails.accountNumber}`,
                status: 'completed',
                reference: withdrawal.clientReference
              });
              await transaction.save();
            }
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Generate receipt for successful payment
              const receipt = await generateWithdrawalReceipt(withdrawal, user);
              
              // Send confirmation email
              try {
                await sendEmail({
                  email: user.email,
                  subject: 'Withdrawal Successful',
                  html: `
                    <h2>Withdrawal Successful</h2>
                    <p>Hello ${user.name},</p>
                    <p>Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been processed successfully.</p>
                    <p><strong>Transaction Reference:</strong> ${transactionData.transactionReference}</p>
                    <p>You can download your receipt from the dashboard.</p>
                    <p>Thank you for using our platform!</p>
                  `
                });
              } catch (emailError) {
                console.error('Failed to send withdrawal confirmation email:', emailError);
              }
            }
            
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt;
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            statusChanged = true;
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Send failure notification email
              try {
                await sendEmail({
                  email: user.email,
                  subject: 'Withdrawal Failed',
                  html: `
                    <h2>Withdrawal Failed</h2>
                    <p>Hello ${user.name},</p>
                    <p>We're sorry, but your withdrawal of ₦${withdrawal.amount.toLocaleString()} has failed.</p>
                    <p><strong>Reason:</strong> ${withdrawal.rejectionReason}</p>
                    <p>The funds have been returned to your account balance. You can try again or contact support if you need assistance.</p>
                  `
                });
              } catch (emailError) {
                console.error('Failed to send withdrawal failure email:', emailError);
              }
            }
          }
          
          if (statusChanged) {
            await withdrawal.save();
            updatedCount++;
            console.log(`Updated withdrawal ${withdrawal._id} to status: ${withdrawal.status}`);
          }
        }
      } catch (apiError) {
        console.error(`Error verifying withdrawal ${withdrawal._id}:`, apiError.message);
        // Continue to next withdrawal if this one fails
      }
    }
    
    console.log(`Updated ${updatedCount} processing withdrawals in this cron job run`);
  } catch (error) {
    console.error('Error in withdrawal verification cron job:', error);
  }
}, {
  scheduled: false // Don't start automatically
});

/**
 * Cron job to verify pending withdrawals
 * Runs every 2 minutes (updated from 10 minutes)
 */
const verifyPendingWithdrawals = cron.schedule('*/10 * * * *', async () => {
  try {
    console.log('Running scheduled pending withdrawal verification...');
    
    // Find all withdrawals in pending state
    const pendingWithdrawals = await Withdrawal.find({
      status: 'pending'
    });
    
    console.log(`Found ${pendingWithdrawals.length} pending withdrawals to verify`);
    
    let updatedCount = 0;
    
    // Process each withdrawal
    for (const withdrawal of pendingWithdrawals) {
      try {
        // Use transaction-by-reference endpoint to get the latest status
        const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
          }
        });
        
        if (response.data && response.data.status) {
          const transactionData = response.data.data;
          let statusChanged = false;
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            statusChanged = true;
            
            // Create a transaction record for successful withdrawal
            const transaction = new ReferralTransaction({
              user: withdrawal.user,
              type: 'withdrawal',
              amount: -withdrawal.amount,
              description: `Withdrawal to ${withdrawal.paymentDetails.bankName} - ${withdrawal.paymentDetails.accountNumber}`,
              status: 'completed',
              reference: withdrawal.clientReference
            });
            await transaction.save();
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Generate receipt for successful payment
              const receipt = await generateWithdrawalReceipt(withdrawal, user);
              
              // Send confirmation email
              try {
                await sendEmail({
                  email: user.email,
                  subject: 'Withdrawal Successful',
                  html: `
                    <h2>Withdrawal Successful</h2>
                    <p>Hello ${user.name},</p>
                    <p>Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been processed successfully.</p>
                    <p><strong>Transaction Reference:</strong> ${transactionData.transactionReference}</p>
                    <p>You can download your receipt from the dashboard.</p>
                    <p>Thank you for using our platform!</p>
                  `
                });
              } catch (emailError) {
                console.error('Failed to send withdrawal confirmation email:', emailError);
              }
            }
            
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt || new Date();
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            statusChanged = true;
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Send failure notification email
              try {
                await sendEmail({
                  email: user.email,
                  subject: 'Withdrawal Failed',
                  html: `
                    <h2>Withdrawal Failed</h2>
                    <p>Hello ${user.name},</p>
                    <p>We're sorry, but your withdrawal of ₦${withdrawal.amount.toLocaleString()} has failed.</p>
                    <p><strong>Reason:</strong> ${withdrawal.rejectionReason}</p>
                    <p>The funds have been returned to your account balance. You can try again or contact support if you need assistance.</p>
                  `
                });
              } catch (emailError) {
                console.error('Failed to send withdrawal failure email:', emailError);
              }
            }
          } else if (transactionData.status === 'processing') {
            withdrawal.status = 'processing';
            statusChanged = true;
          }
          
          if (statusChanged) {
            await withdrawal.save();
            updatedCount++;
            console.log(`Updated pending withdrawal ${withdrawal._id} to status: ${withdrawal.status}`);
          }
        }
      } catch (apiError) {
        console.error(`Error verifying pending withdrawal ${withdrawal._id}:`, apiError.message);
        // Continue to next withdrawal if this one fails
      }
    }
    
    console.log(`Updated ${updatedCount} pending withdrawals in this cron job run`);
  } catch (error) {
    console.error('Error in pending withdrawal verification cron job:', error);
  }
}, {
  scheduled: false // Don't start automatically
});

// Export the cron jobs
module.exports = {
  verifyProcessingWithdrawals,
  verifyPendingWithdrawals,
  startAll: () => {
    verifyProcessingWithdrawals.start();
    verifyPendingWithdrawals.start();
    console.log('All withdrawal verification cron jobs started');
  },
  stopAll: () => {
    verifyProcessingWithdrawals.stop();
    verifyPendingWithdrawals.stop();
    console.log('All withdrawal verification cron jobs stopped');
  }
};