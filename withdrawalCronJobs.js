const cron = require('node-cron');
const Withdrawal = require('./models/Withdrawal');
const ReferralTransaction = require('./models/ReferralTransaction');
const axios = require('axios');
const User = require('./models/User');
const { sendEmail } = require('./utils/emailService');
const { generateWithdrawalReceipt } = require('./utils/withdrawalReceiptService.js'); // Fixed duplicate .js extension

// Log whether API key is configured
console.log('LENCO_API_KEY configured:', process.env.LENCO_API_KEY ? 'Yes' : 'No');

/**
 * Cron job to verify and update processing withdrawals
 * Runs every 2 minutes
 */
const verifyProcessingWithdrawals = cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('=== CRON JOB: Running scheduled withdrawal status verification ===');
    console.log('Timestamp:', new Date().toISOString());
    
    // Find all withdrawals in processing state
    const processingWithdrawals = await Withdrawal.find({
      status: 'processing'
    });
    
    console.log(`Found ${processingWithdrawals.length} processing withdrawals to verify`);
    
    if (processingWithdrawals.length === 0) {
      console.log('No processing withdrawals to check. Cron job complete.');
      return;
    }
    
    let updatedCount = 0;
    
    // Process each withdrawal
    for (const withdrawal of processingWithdrawals) {
      try {
        console.log(`Checking withdrawal ${withdrawal._id} with Lenco API using reference: ${withdrawal.clientReference}`);
        
        // Use transaction-by-reference endpoint to get the latest status
        const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
          }
        });
        
        console.log(`Lenco API Response for ${withdrawal._id}:`, JSON.stringify(response.data, null, 2));
        
        if (response.data && response.data.status) {
          const transactionData = response.data.data;
          let statusChanged = false;
          
          console.log(`Current withdrawal status: ${withdrawal.status}, Lenco status: ${transactionData.status}`);
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            statusChanged = true;
            console.log(`Withdrawal ${withdrawal._id} marked as PAID`);
            
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
              console.log(`Created transaction record for withdrawal ${withdrawal._id}`);
            }
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Generate receipt for successful payment
              console.log(`Generating receipt for user ${user._id}`);
              try {
                const receipt = await generateWithdrawalReceipt(withdrawal, user);
                console.log(`Receipt generated successfully: ${receipt ? 'Yes' : 'No'}`);
              } catch (receiptError) {
                console.error(`Error generating receipt: ${receiptError.message}`);
              }
              
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
                console.log(`Success email sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send withdrawal confirmation email: ${emailError.message}`);
              }
            } else {
              console.log(`User ${withdrawal.user} not found for email notification`);
            }
            
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt || new Date();
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            statusChanged = true;
            console.log(`Withdrawal ${withdrawal._id} marked as FAILED: ${withdrawal.rejectionReason}`);
            
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
                console.log(`Failure email sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send withdrawal failure email: ${emailError.message}`);
              }
            }
          } else {
            console.log(`No status change needed for withdrawal ${withdrawal._id}. Lenco status still: ${transactionData.status}`);
          }
          
          if (statusChanged) {
            console.log(`Saving withdrawal ${withdrawal._id} with updated status: ${withdrawal.status}`);
            await withdrawal.save();
            updatedCount++;
            console.log(`Updated withdrawal ${withdrawal._id} to status: ${withdrawal.status}`);
          }
        } else {
          console.log(`No valid data in Lenco response for withdrawal ${withdrawal._id}`);
        }
      } catch (apiError) {
        console.error(`Error verifying withdrawal ${withdrawal._id}:`, apiError.message);
        if (apiError.response) {
          console.error(`API Response Error:`, JSON.stringify(apiError.response.data, null, 2));
        }
        // Continue to next withdrawal if this one fails
      }
    }
    
    console.log(`Updated ${updatedCount} of ${processingWithdrawals.length} processing withdrawals in this cron job run`);
    console.log('=== CRON JOB: Processing withdrawals verification completed ===');
  } catch (error) {
    console.error('Error in withdrawal verification cron job:', error);
  }
}, {
  scheduled: false // Don't start automatically
});

/**
 * Cron job to verify pending withdrawals
 * Runs every 2 minutes
 */
const verifyPendingWithdrawals = cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('=== CRON JOB: Running scheduled pending withdrawal verification ===');
    console.log('Timestamp:', new Date().toISOString());
    
    // Find all withdrawals in pending state
    const pendingWithdrawals = await Withdrawal.find({
      status: 'pending'
    });
    
    console.log(`Found ${pendingWithdrawals.length} pending withdrawals to verify`);
    
    if (pendingWithdrawals.length === 0) {
      console.log('No pending withdrawals to check. Cron job complete.');
      return;
    }
    
    let updatedCount = 0;
    
    // Process each withdrawal
    for (const withdrawal of pendingWithdrawals) {
      try {
        console.log(`Checking pending withdrawal ${withdrawal._id} with Lenco API using reference: ${withdrawal.clientReference}`);
        
        // Use transaction-by-reference endpoint to get the latest status
        const response = await axios.get(`https://api.lenco.co/access/v1/transaction-by-reference/${withdrawal.clientReference}`, {
          headers: {
            'Authorization': `Bearer ${process.env.LENCO_API_KEY}`
          }
        });
        
        console.log(`Lenco API Response for pending ${withdrawal._id}:`, JSON.stringify(response.data, null, 2));
        
        if (response.data && response.data.status) {
          const transactionData = response.data.data;
          let statusChanged = false;
          
          console.log(`Current pending withdrawal status: ${withdrawal.status}, Lenco status: ${transactionData.status}`);
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            statusChanged = true;
            console.log(`Pending withdrawal ${withdrawal._id} marked as PAID`);
            
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
            console.log(`Created transaction record for pending withdrawal ${withdrawal._id}`);
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Generate receipt for successful payment
              console.log(`Generating receipt for user ${user._id}`);
              try {
                const receipt = await generateWithdrawalReceipt(withdrawal, user);
                console.log(`Receipt generated successfully: ${receipt ? 'Yes' : 'No'}`);
              } catch (receiptError) {
                console.error(`Error generating receipt: ${receiptError.message}`);
              }
              
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
                console.log(`Success email sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send withdrawal confirmation email: ${emailError.message}`);
              }
            }
            
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt || new Date();
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            statusChanged = true;
            console.log(`Pending withdrawal ${withdrawal._id} marked as FAILED: ${withdrawal.rejectionReason}`);
            
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
                console.log(`Failure email sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send withdrawal failure email: ${emailError.message}`);
              }
            }
          } else if (transactionData.status === 'processing') {
            withdrawal.status = 'processing';
            statusChanged = true;
            console.log(`Pending withdrawal ${withdrawal._id} moved to PROCESSING state`);
          } else {
            console.log(`No status change needed for pending withdrawal ${withdrawal._id}. Lenco status: ${transactionData.status}`);
          }
          
          if (statusChanged) {
            console.log(`Saving pending withdrawal ${withdrawal._id} with updated status: ${withdrawal.status}`);
            await withdrawal.save();
            updatedCount++;
            console.log(`Updated pending withdrawal ${withdrawal._id} to status: ${withdrawal.status}`);
          }
        } else {
          console.log(`No valid data in Lenco response for pending withdrawal ${withdrawal._id}`);
        }
      } catch (apiError) {
        console.error(`Error verifying pending withdrawal ${withdrawal._id}:`, apiError.message);
        if (apiError.response) {
          console.error(`API Response Error:`, JSON.stringify(apiError.response.data, null, 2));
        }
        // Continue to next withdrawal if this one fails
      }
    }
    
    console.log(`Updated ${updatedCount} of ${pendingWithdrawals.length} pending withdrawals in this cron job run`);
    console.log('=== CRON JOB: Pending withdrawals verification completed ===');
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
    console.log('Starting all withdrawal verification cron jobs...');
    verifyProcessingWithdrawals.start();
    verifyPendingWithdrawals.start();
    console.log('All withdrawal verification cron jobs started');
  },
  stopAll: () => {
    console.log('Stopping all withdrawal verification cron jobs...');
    verifyProcessingWithdrawals.stop();
    verifyPendingWithdrawals.stop();
    console.log('All withdrawal verification cron jobs stopped');
  }
};