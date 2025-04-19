// utils/installmentScheduler.js
const cron = require('node-cron');
const ShareInstallment = require('../models/ShareInstallment');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

/**
 * Schedule a monthly job to apply penalties to overdue installments
 */
const scheduleInstallmentPenalties = () => {
  // Run at midnight on the 1st day of each month
  cron.schedule('0 0 1 * *', async () => {
    console.log('Running scheduled task: Apply penalties to overdue installments');
    
    try {
      // Get all active installments with overdue payments
      const overdueInstallments = await ShareInstallment.getPendingPenaltyInstallments();
      
      console.log(`Found ${overdueInstallments.length} overdue installments`);
      
      let penaltiesApplied = 0;
      let defaulted = 0;
      let totalPenaltyAmount = 0;
      
      // Process each installment
      for (const installment of overdueInstallments) {
        try {
          // Calculate and apply penalty
          const penaltyResult = installment.calculatePenalty();
          
          if (penaltyResult.penaltyApplied) {
            penaltiesApplied++;
            totalPenaltyAmount += penaltyResult.penaltyAmount;
            
            // Check if defaulted
            if (installment.installmentStatus === 'defaulted') {
              defaulted++;
            }
            
            await installment.save();
            
            // Notify user about penalty
            const user = await User.findById(installment.user);
            if (user && user.email) {
              try {
                await sendEmail({
                  email: user.email,
                  subject: 'AfriMobile - Share Installment Penalty Applied',
                  html: `
                    <h2>Installment Payment Overdue</h2>
                    <p>Dear ${user.name},</p>
                    <p>We notice that your installment payment is overdue. A penalty of ${installment.currency === 'naira' ? '₦' : '$'}${penaltyResult.penaltyAmount.toFixed(2)} (0.3%) has been applied to your remaining balance.</p>
                    <p>New Remaining Amount: ${installment.currency === 'naira' ? '₦' : '$'}${installment.remainingAmount.toFixed(2)}</p>
                    <p>Next Payment Due: ${installment.nextPaymentDue.toLocaleDateString()}</p>
                    <p>Please make your payment as soon as possible to avoid additional penalties.</p>
                    ${installment.installmentStatus === 'defaulted' ? 
                      `<p>Warning: Your installment plan has been marked as defaulted due to multiple missed payments. Please contact our support team immediately.</p>` : 
                      ``
                    }
                  `
                });
              } catch (emailError) {
                console.error('Failed to send penalty notification email:', emailError);
              }
            }
          }
        } catch (error) {
          console.error(`Error processing penalty for installment ${installment._id}:`, error);
        }
      }
      
      console.log(`Applied penalties to ${penaltiesApplied} installments`);
      console.log(`Total penalty amount: ${totalPenaltyAmount.toFixed(2)}`);
      console.log(`Installments marked as defaulted: ${defaulted}`);
      
      // Send summary report to admin
      try {
        const adminEmails = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : [];
        if (adminEmails.length > 0) {
          await sendEmail({
            email: adminEmails,
            subject: 'AfriMobile - Monthly Installment Penalty Report',
            html: `
              <h2>Monthly Installment Penalty Report</h2>
              <p>Date: ${new Date().toLocaleDateString()}</p>
              <p>Total overdue installments: ${overdueInstallments.length}</p>
              <p>Penalties applied: ${penaltiesApplied}</p>
              <p>Total penalty amount: ${totalPenaltyAmount.toFixed(2)}</p>
              <p>Installments marked as defaulted: ${defaulted}</p>
            `
          });
        }
      } catch (emailError) {
        console.error('Failed to send admin summary report:', emailError);
      }
    } catch (error) {
      console.error('Error running installment penalty task:', error);
    }
  });
  
  // Also schedule a reminder job 7 days before end of month
  cron.schedule('0 0 23 * *', async () => {
    // Get the last day of the current month
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
    // Only run on the 23rd if the month has 30 or 31 days
    if (lastDay >= 30 && now.getDate() === 23) {
      console.log('Running scheduled task: Send installment payment reminders');
      
      try {
        // Get all active installments
        const activeInstallments = await ShareInstallment.find({ 
          installmentStatus: 'active'
        });
        
        console.log(`Found ${activeInstallments.length} active installments`);
        
        let remindersSent = 0;
        
        // Send reminders
        for (const installment of activeInstallments) {
          try {
            const user = await User.findById(installment.user);
            
            if (user && user.email) {
              await sendEmail({
                email: user.email,
                subject: 'AfriMobile - Installment Payment Reminder',
                html: `
                  <h2>Installment Payment Reminder</h2>
                  <p>Dear ${user.name},</p>
                  <p>This is a friendly reminder that your next installment payment is due on ${installment.nextPaymentDue.toLocaleDateString()}.</p>
                  <p>Outstanding Amount: ${installment.currency === 'naira' ? '₦' : '$'}${installment.remainingAmount.toFixed(2)}</p>
                  <p>Current Progress: ${installment.percentagePaid.toFixed(2)}% paid</p>
                  <p>Minimum payment required: ${installment.currency === 'naira' ? '₦' : '$'}${(installment.remainingAmount * 0.2).toFixed(2)} (20% of remaining amount)</p>
                  <p>Please ensure you make your payment on time to avoid penalties (0.3% of remaining amount).</p>
                  <p>Thank you for your continued investment in AfriMobile!</p>
                `
              });
              
              remindersSent++;
            }
          } catch (error) {
            console.error(`Error sending reminder for installment ${installment._id}:`, error);
          }
        }
        
        console.log(`Sent ${remindersSent} payment reminders`);
      } catch (error) {
        console.error('Error running installment reminder task:', error);
      }
    }
  });
};

module.exports = {
  scheduleInstallmentPenalties
};