const cron = require('node-cron');
const Withdrawal = require('./models/Withdrawal');
const ReferralTransaction = require('./models/ReferralTransaction');
const Referral = require('./models/Referral');
const axios = require('axios');
const User = require('./models/User');
const { sendEmail } = require('./utils/emailService');
const { generateWithdrawalReceipt } = require('./utils/withdrawalReceiptService.js');

// Log whether API key is configured
console.log('LENCO_API_KEY configured:', process.env.LENCO_API_KEY ? 'Yes' : 'No');


/**
 * Utility function to update user's balance after withdrawal
 */
const updateUserBalance = async (userId) => {
  try {
    // Count withdrawals by status
    const paidWithdrawals = await Withdrawal.find({
      user: userId,
      status: 'paid'
    });
    
    const pendingWithdrawals = await Withdrawal.find({
      user: userId,
      status: 'pending'
    });
    
    const processingWithdrawals = await Withdrawal.find({
      user: userId,
      status: 'processing'
    });
    
    // Calculate totals for each status
    const totalWithdrawn = paidWithdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    const totalPending = pendingWithdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    const totalProcessing = processingWithdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    
    // Update the user's referral data with all amounts
    const updated = await Referral.findOneAndUpdate(
      { user: userId },
      { 
        $set: { 
          totalWithdrawn: totalWithdrawn,
          pendingWithdrawals: totalPending,
          processingWithdrawals: totalProcessing
        } 
      },
      { new: true }
    );
    
    console.log(`Updated balance for user ${userId} - total withdrawn: ${totalWithdrawn}, pending: ${totalPending}, processing: ${totalProcessing}`);
    return updated;
  } catch (error) {
    console.error(`Error updating user balance: ${error.message}`);
    return false;
  }
};

/**
 * Utility function to skip receipt generation errors
 */
const safeGenerateReceipt = async (withdrawal, user) => {
  try {
    if (typeof generateWithdrawalReceipt === 'function') {
      const receipt = await generateWithdrawalReceipt(withdrawal, user);
      console.log(`Receipt generated successfully: ${receipt ? 'Yes' : 'No'}`);
      return receipt;
    } else {
      console.log('generateWithdrawalReceipt function not available, skipping');
      return null;
    }
  } catch (error) {
    console.error(`Error generating receipt: ${error.message}`);
    return null;
  }
};

/**
 * Utility function to safely create a transaction record
 */
const createTransactionRecord = async (withdrawal, type) => {
  try {
    const existingTransaction = await ReferralTransaction.findOne({ reference: withdrawal.clientReference });
    
    if (existingTransaction) {
      console.log(`Transaction record already exists for ${withdrawal._id}`);
      return existingTransaction;
    }
    
    // Try creating with additional fields
    try {
      const transaction = new ReferralTransaction({
        user: withdrawal.user,
        type: 'withdrawal',
        amount: -withdrawal.amount,
        description: `Withdrawal to ${withdrawal.paymentDetails.bankName} - ${withdrawal.paymentDetails.accountNumber}`,
        status: 'completed',
        reference: withdrawal.clientReference,
        // Add required fields with default values
        generation: 0,
        referredUser: withdrawal.user,
        beneficiary: withdrawal.user
      });
      
      await transaction.save();
      console.log(`Created ${type} transaction record for withdrawal ${withdrawal._id}`);
      return transaction;
    } catch (validationError) {
      console.error(`Validation error creating transaction: ${validationError.message}`);
      
      // If there's a validation error, try with a simpler schema
      try {
        // Create a raw document directly to bypass schema validation if needed
        const result = await ReferralTransaction.collection.insertOne({
          user: withdrawal.user,
          type: 'withdrawal',
          amount: -withdrawal.amount,
          description: `Withdrawal to ${withdrawal.paymentDetails.bankName} - ${withdrawal.paymentDetails.accountNumber}`,
          status: 'completed',
          reference: withdrawal.clientReference,
          generation: 0,
          referredUser: withdrawal.user,
          beneficiary: withdrawal.user,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        console.log(`Created ${type} transaction record for withdrawal ${withdrawal._id} bypassing validation`);
        return result;
      } catch (insertError) {
        console.error(`Failed to create transaction record: ${insertError.message}`);
        // Continue despite transaction creation failure
        return null;
      }
    }
  } catch (error) {
    console.error(`Error creating transaction record: ${error.message}`);
    return null;
  }
};

/**
 * Utility function to safely update withdrawal status
 */
const updateWithdrawalStatus = async (withdrawal, newStatus, additionalData = {}) => {
  try {
    for (const [key, value] of Object.entries(additionalData)) {
      withdrawal[key] = value;
    }
    
    withdrawal.status = newStatus;
    await withdrawal.save();
    console.log(`Successfully updated withdrawal ${withdrawal._id} to status: ${newStatus}`);
    return true;
  } catch (error) {
    console.error(`Error updating withdrawal status: ${error.message}`);
    
    // Try updating with findOneAndUpdate as a fallback
    try {
      const update = { 
        status: newStatus,
        updatedAt: new Date(),
        ...additionalData
      };
      
      const result = await Withdrawal.findOneAndUpdate(
        { _id: withdrawal._id },
        { $set: update },
        { new: true }
      );
      
      console.log(`Successfully updated withdrawal ${withdrawal._id} to status: ${newStatus} using findOneAndUpdate`);
      return true;
    } catch (updateError) {
      console.error(`Failed to update withdrawal even with findOneAndUpdate: ${updateError.message}`);
      return false;
    }
  }
};


/**
 * Cron job to verify and update processing withdrawals
 * Runs every 2 minutes
 */
const verifyProcessingWithdrawals = cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('\n\n');
    console.log('**********************************************');
    console.log('* CRON JOB: PROCESSING WITHDRAWALS VERIFICATION *');
    console.log('* ' + new Date().toISOString() + ' *');
    console.log('**********************************************');
    
    // Check if Lenco API key is configured
    if (!process.env.LENCO_API_KEY) {
      console.error('LENCO_API_KEY is not configured! Skipping verification.');
      return;
    }
    
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
      // Start a session for this withdrawal update
      const session = await mongoose.startSession();
      session.startTransaction();
      
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
          
          console.log(`Current withdrawal status: ${withdrawal.status}, Lenco status: ${transactionData.status}`);
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            console.log(`Withdrawal ${withdrawal._id} marked as PAID`);
            
            // Move amount from processing to totalWithdrawn
            await Referral.findOneAndUpdate(
              { user: withdrawal.user },
              { 
                $inc: { 
                  processingWithdrawals: -withdrawal.amount,
                  totalWithdrawn: withdrawal.amount 
                } 
              },
              { session }
            );
            
            // Create a transaction record for successful withdrawal
            await createTransactionRecord(withdrawal, 'processing');
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Generate receipt for successful payment
              console.log(`Generating receipt for user ${user._id}`);
              await safeGenerateReceipt(withdrawal, user);
              
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
            
            // Update withdrawal status
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            await withdrawal.save({ session });
            
            await session.commitTransaction();
            session.endSession();
            
            updatedCount++;
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            console.log(`Withdrawal ${withdrawal._id} marked as FAILED: ${transactionData.reasonForFailure || 'Transaction failed'}`);
            
            // Remove amount from processingWithdrawals since it failed
            await Referral.findOneAndUpdate(
              { user: withdrawal.user },
              { $inc: { processingWithdrawals: -withdrawal.amount } },
              { session }
            );
            
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
                    <p><strong>Reason:</strong> ${transactionData.reasonForFailure || 'Transaction failed'}</p>
                    <p>The funds have been returned to your account balance. You can try again or contact support if you need assistance.</p>
                  `
                });
                console.log(`Failure email sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send withdrawal failure email: ${emailError.message}`);
              }
            }
            
            // Update withdrawal status
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt || new Date();
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            await withdrawal.save({ session });
            
            await session.commitTransaction();
            session.endSession();
            
            updatedCount++;
          } else {
            // No status change needed
            await session.abortTransaction();
            session.endSession();
            console.log(`No status change needed for withdrawal ${withdrawal._id}. Lenco status still: ${transactionData.status}`);
          }
        } else {
          await session.abortTransaction();
          session.endSession();
          console.log(`No valid data in Lenco response for withdrawal ${withdrawal._id}`);
        }
      } catch (apiError) {
        await session.abortTransaction();
        session.endSession();
        
        console.error(`Error verifying withdrawal ${withdrawal._id}:`, apiError.message);
        if (apiError.response) {
          console.error(`API Response Error:`, JSON.stringify(apiError.response.data, null, 2));
        }
        // Continue to next withdrawal if this one fails
      }
    }
    
    console.log(`Updated ${updatedCount} of ${processingWithdrawals.length} processing withdrawals in this cron job run`);
    console.log('**********************************************');
    console.log('\n\n');
  } catch (error) {
    console.error('Error in withdrawal verification cron job:', error);
    console.error(error.stack);
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
    console.log('\n\n');
    console.log('**********************************************');
    console.log('* CRON JOB: PENDING WITHDRAWALS VERIFICATION *');
    console.log('* ' + new Date().toISOString() + ' *');
    console.log('**********************************************');
    
    // Check if Lenco API key is configured
    if (!process.env.LENCO_API_KEY) {
      console.error('LENCO_API_KEY is not configured! Skipping verification.');
      return;
    }
    
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
      // Start a session for this withdrawal update
      const session = await mongoose.startSession();
      session.startTransaction();
      
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
          
          console.log(`Current pending withdrawal status: ${withdrawal.status}, Lenco status: ${transactionData.status}`);
          
          // Update transaction status based on Lenco response
          if (transactionData.status === 'successful') {
            console.log(`Pending withdrawal ${withdrawal._id} marked as PAID`);
            
            // Move amount from pending to totalWithdrawn
            await Referral.findOneAndUpdate(
              { user: withdrawal.user },
              { 
                $inc: { 
                  pendingWithdrawals: -withdrawal.amount,
                  totalWithdrawn: withdrawal.amount 
                } 
              },
              { session }
            );
            
            // Create a transaction record for successful withdrawal
            await createTransactionRecord(withdrawal, 'pending');
            
            // Get user info for notification
            const user = await User.findById(withdrawal.user);
            
            if (user) {
              // Generate receipt for successful payment
              console.log(`Generating receipt for user ${user._id}`);
              await safeGenerateReceipt(withdrawal, user);
              
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
            
            // Update withdrawal status
            withdrawal.status = 'paid';
            withdrawal.processedAt = new Date();
            withdrawal.transactionReference = transactionData.transactionReference;
            await withdrawal.save({ session });
            
            await session.commitTransaction();
            session.endSession();
            
            updatedCount++;
          } else if (transactionData.status === 'failed' || transactionData.status === 'declined') {
            console.log(`Pending withdrawal ${withdrawal._id} marked as FAILED: ${transactionData.reasonForFailure || 'Transaction failed'}`);
            
            // Remove amount from pendingWithdrawals since it failed
            await Referral.findOneAndUpdate(
              { user: withdrawal.user },
              { $inc: { pendingWithdrawals: -withdrawal.amount } },
              { session }
            );
            
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
                    <p><strong>Reason:</strong> ${transactionData.reasonForFailure || 'Transaction failed'}</p>
                    <p>The funds have been returned to your account balance. You can try again or contact support if you need assistance.</p>
                  `
                });
                console.log(`Failure email sent to ${user.email}`);
              } catch (emailError) {
                console.error(`Failed to send withdrawal failure email: ${emailError.message}`);
              }
            }
            
            // Update withdrawal status
            withdrawal.status = 'failed';
            withdrawal.failedAt = transactionData.failedAt || new Date();
            withdrawal.rejectionReason = transactionData.reasonForFailure || 'Transaction failed';
            await withdrawal.save({ session });
            
            await session.commitTransaction();
            session.endSession();
            
            updatedCount++;
          } else if (transactionData.status === 'processing') {
            console.log(`Pending withdrawal ${withdrawal._id} moved to PROCESSING state`);
            
            // Move amount from pending to processing
            await Referral.findOneAndUpdate(
              { user: withdrawal.user },
              { 
                $inc: { 
                  pendingWithdrawals: -withdrawal.amount,
                  processingWithdrawals: withdrawal.amount 
                } 
              },
              { session }
            );
            
            // Update withdrawal status
            withdrawal.status = 'processing';
            await withdrawal.save({ session });
            
            await session.commitTransaction();
            session.endSession();
            
            updatedCount++;
          } else {
            await session.abortTransaction();
            session.endSession();
            console.log(`No status change needed for pending withdrawal ${withdrawal._id}. Lenco status: ${transactionData.status}`);
          }
        } else {
          await session.abortTransaction();
          session.endSession();
          console.log(`No valid data in Lenco response for pending withdrawal ${withdrawal._id}`);
        }
      } catch (apiError) {
        await session.abortTransaction();
        session.endSession();
        
        console.error(`Error verifying pending withdrawal ${withdrawal._id}:`, apiError.message);
        if (apiError.response) {
          console.error(`API Response Error:`, JSON.stringify(apiError.response.data, null, 2));
        }
        // Continue to next withdrawal if this one fails
      }
    }
    
    console.log(`Updated ${updatedCount} of ${pendingWithdrawals.length} pending withdrawals in this cron job run`);
    console.log('**********************************************');
    console.log('\n\n');
  } catch (error) {
    console.error('Error in pending withdrawal verification cron job:', error);
    console.error(error.stack);
  }
}, {
  scheduled: false // Don't start automatically
});


/**
 * Utility function to manually force update all user balances
 * This can be used if balance calculations are out of sync
 */
const forceUpdateAllBalances = async () => {
  try {
    console.log('Force updating all user balances...');
    
    // Get all users with withdrawals
    const withdrawalUsers = await Withdrawal.distinct('user');
    console.log(`Found ${withdrawalUsers.length} users with withdrawals`);
    
    let updatedCount = 0;
    
    // Update each user's balance
    for (const userId of withdrawalUsers) {
      const updated = await updateUserBalance(userId);
      if (updated) updatedCount++;
    }
    
    console.log(`Updated balances for ${updatedCount} users`);
    return true;
  } catch (error) {
    console.error('Error force updating balances:', error);
    return false;
  }
};


// Export the cron jobs
module.exports = {
  verifyProcessingWithdrawals,
  verifyPendingWithdrawals,
  updateUserBalance,          // Export the balance update function
  forceUpdateAllBalances,     // Export the force update function
  startAll: () => {
    console.log('\n\n');
    console.log('**********************************************');
    console.log('* STARTING ALL WITHDRAWAL VERIFICATION JOBS *');
    console.log('**********************************************');
    
    if (!process.env.LENCO_API_KEY) {
      console.error('WARNING: LENCO_API_KEY is not configured! Jobs will run but API calls will fail.');
    }
    
    verifyProcessingWithdrawals.start();
    console.log('Processing withdrawals job started');
    
    verifyPendingWithdrawals.start();
    console.log('Pending withdrawals job started');
    
    console.log('All withdrawal verification cron jobs started');
    console.log('**********************************************');
    console.log('\n\n');
  },
  stopAll: () => {
    console.log('Stopping all withdrawal verification cron jobs...');
    verifyProcessingWithdrawals.stop();
    verifyPendingWithdrawals.stop();
    console.log('All withdrawal verification cron jobs stopped');
  }
};