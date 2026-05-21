// utils/coFounderInstallmentScheduler.js
const cron = require('node-cron');
const CoFounderInstallmentPlan = require('../models/CoFounderInstallmentPlan');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

class CoFounderInstallmentScheduler {
  constructor() {
    this.jobs = [];
  }

  /**
   * Schedule co-founder installment penalty checks
   */
  scheduleCoFounderInstallmentPenalties() {
    console.log('Setting up co-founder installment penalty scheduler...');

    // Daily check for overdue payments (runs at 2:00 AM daily)
    const dailyJob = cron.schedule('0 2 * * *', async () => {
      console.log('\n======================================');
      console.log('DAILY CO-FOUNDER INSTALLMENT PENALTY CHECK');
      console.log('======================================');
      console.log('Time:', new Date().toISOString());
      
      try {
        await this.checkAndApplyPenalties();
      } catch (error) {
        console.error('Error in daily co-founder installment penalty check:', error);
      }
      
      console.log('======================================\n');
    }, {
      scheduled: false // Don't start automatically
    });

    // Weekly comprehensive check (runs every Sunday at 3:00 AM)
    const weeklyJob = cron.schedule('0 3 * * 0', async () => {
      console.log('\n======================================');
      console.log('WEEKLY CO-FOUNDER INSTALLMENT COMPREHENSIVE CHECK');
      console.log('======================================');
      console.log('Time:', new Date().toISOString());
      
      try {
        await this.comprehensiveCheck();
      } catch (error) {
        console.error('Error in weekly co-founder installment check:', error);
      }
      
      console.log('======================================\n');
    }, {
      scheduled: false // Don't start automatically
    });

    // Monthly penalty application (runs on 1st of every month at 4:00 AM)
    const monthlyJob = cron.schedule('0 4 1 * *', async () => {
      console.log('\n======================================');
      console.log('MONTHLY CO-FOUNDER INSTALLMENT PENALTY APPLICATION');
      console.log('======================================');
      console.log('Time:', new Date().toISOString());
      
      try {
        await this.monthlyPenaltyCheck();
      } catch (error) {
        console.error('Error in monthly co-founder penalty application:', error);
      }
      
      console.log('======================================\n');
    }, {
      scheduled: false // Don't start automatically
    });

    // Store jobs for later control
    this.jobs = [
      { name: 'daily', job: dailyJob },
      { name: 'weekly', job: weeklyJob },
      { name: 'monthly', job: monthlyJob }
    ];

    // Start all jobs
    this.startAll();

    console.log('✅ Co-founder installment penalty scheduler initialized');
    console.log('📅 Daily check: 2:00 AM');
    console.log('📅 Weekly comprehensive: Sunday 3:00 AM');
    console.log('📅 Monthly penalties: 1st of month 4:00 AM');
  }

  /**
   * Start all scheduled jobs
   */
  startAll() {
    this.jobs.forEach(({ name, job }) => {
      job.start();
      console.log(`✅ Co-founder ${name} job started`);
    });
  }

  /**
   * Stop all scheduled jobs
   */
  stopAll() {
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      console.log(`🛑 Co-founder ${name} job stopped`);
    });
  }

  /**
   * Check and apply penalties for overdue co-founder installments
   */
  async checkAndApplyPenalties() {
    try {
      console.log('Starting co-founder installment penalty check...');
      
      // Get all active co-founder installment plans
      const activePlans = await CoFounderInstallmentPlan.find({
        status: { $in: ['active', 'pending', 'late'] }
      });

      console.log(`Found ${activePlans.length} active co-founder installment plans`);

      const now = new Date();
      let penaltiesApplied = 0;
      let notificationsSent = 0;

      for (const plan of activePlans) {
        let planUpdated = false;

        // Check each installment for overdue status
        for (const installment of plan.installments) {
          if (installment.status !== 'completed' && installment.dueDate < now) {
            const daysOverdue = Math.floor((now - installment.dueDate) / (1000 * 60 * 60 * 24));
            
            // Apply penalty if more than 7 days overdue
            if (daysOverdue > 7) {
              const monthsOverdue = Math.ceil(daysOverdue / 30);
              const lateFeePercentage = plan.lateFeePercentage || 0.5; // 0.5% per month
              const maxLateFeePercentage = 7.5; // Cap at 7.5% of total price
              
              // Calculate penalty
              const remainingAmount = installment.amount - (installment.paidAmount || 0);
              const monthlyPenalty = (remainingAmount * lateFeePercentage) / 100;
              const totalPenalty = monthlyPenalty * monthsOverdue;
              const maxAllowedPenalty = (plan.totalPrice * maxLateFeePercentage) / 100;
              const cappedPenalty = Math.min(totalPenalty, maxAllowedPenalty);

              // Update installment if penalty increased
              if (cappedPenalty > (installment.lateFee || 0)) {
                installment.lateFee = cappedPenalty;
                installment.status = 'overdue';
                planUpdated = true;
                penaltiesApplied++;

                console.log(`Applied penalty to plan ${plan.planId}, installment ${installment.installmentNumber}: ${plan.currency === 'naira' ? '₦' : '$'}${cappedPenalty.toFixed(2)}`);
              }
            }
          }
        }

        // Update plan status if needed
        const overdueInstallments = plan.installments.filter(inst => 
          inst.status === 'overdue' || (inst.status !== 'completed' && inst.dueDate < now)
        );

        if (overdueInstallments.length > 0 && plan.status !== 'late') {
          plan.status = 'late';
          plan.monthsLate = Math.max(...overdueInstallments.map(inst => 
            Math.ceil((now - inst.dueDate) / (1000 * 60 * 60 * 24 * 30))
          ));
          planUpdated = true;
        }

        // Save plan if updated
        if (planUpdated) {
          plan.updatedAt = now;
          await plan.save();

          // Send notification to user
          try {
            const user = await User.findById(plan.user);
            if (user?.email && sendEmail) {
              await this.sendLatePaymentNotification(user, plan, overdueInstallments);
              notificationsSent++;
            }
          } catch (emailError) {
            console.error(`Failed to send notification for plan ${plan.planId}:`, emailError);
          }
        }
      }

      console.log(`Co-founder penalty check completed:`);
      console.log(`- Plans checked: ${activePlans.length}`);
      console.log(`- Penalties applied: ${penaltiesApplied}`);
      console.log(`- Notifications sent: ${notificationsSent}`);

      return {
        plansChecked: activePlans.length,
        penaltiesApplied,
        notificationsSent
      };

    } catch (error) {
      console.error('Error in co-founder penalty check:', error);
      throw error;
    }
  }

  /**
   * Comprehensive weekly check for co-founder installment plans
   */
  async comprehensiveCheck() {
    try {
      console.log('Starting comprehensive co-founder installment check...');

      // Run penalty check
      const penaltyResults = await this.checkAndApplyPenalties();

      // Additional comprehensive checks
      const stats = await this.generateWeeklyStats();

      // Send admin summary
      if (sendEmail) {
        await this.sendWeeklyAdminSummary(penaltyResults, stats);
      }

      console.log('Comprehensive co-founder check completed');
      
      return {
        penaltyResults,
        stats
      };

    } catch (error) {
      console.error('Error in comprehensive co-founder check:', error);
      throw error;
    }
  }

  /**
   * Monthly penalty application for co-founder installments
   */
  async monthlyPenaltyCheck() {
    try {
      console.log('Starting monthly co-founder penalty application...');

      // Get all late co-founder plans
      const latePlans = await CoFounderInstallmentPlan.find({
        status: 'late'
      });

      console.log(`Found ${latePlans.length} late co-founder installment plans`);

      let penaltiesApplied = 0;
      const now = new Date();

      for (const plan of latePlans) {
        let planUpdated = false;
        
        // Calculate and apply monthly penalty
        const remainingBalance = plan.totalPrice - (plan.totalPaidAmount || 0);
        const lateFeePercentage = plan.lateFeePercentage || 0.5;
        const monthlyPenalty = (remainingBalance * lateFeePercentage) / 100;
        const maxAllowedPenalty = (plan.totalPrice * 7.5) / 100; // 7.5% cap

        const newTotalPenalty = Math.min(
          (plan.currentLateFee || 0) + monthlyPenalty,
          maxAllowedPenalty
        );

        if (newTotalPenalty > (plan.currentLateFee || 0)) {
          plan.currentLateFee = newTotalPenalty;
          plan.monthsLate = (plan.monthsLate || 0) + 1;
          plan.lastLateCheckDate = now;
          plan.updatedAt = now;
          planUpdated = true;
          penaltiesApplied++;

          console.log(`Applied monthly penalty to plan ${plan.planId}: ${plan.currency === 'naira' ? '₦' : '$'}${monthlyPenalty.toFixed(2)}`);
        }

        if (planUpdated) {
          await plan.save();

          // Send monthly penalty notification
          try {
            const user = await User.findById(plan.user);
            if (user?.email && sendEmail) {
              await this.sendMonthlyPenaltyNotification(user, plan, monthlyPenalty);
            }
          } catch (emailError) {
            console.error(`Failed to send monthly penalty notification for plan ${plan.planId}:`, emailError);
          }
        }
      }

      console.log(`Monthly co-founder penalty application completed: ${penaltiesApplied} penalties applied`);

      return {
        plansProcessed: latePlans.length,
        penaltiesApplied
      };

    } catch (error) {
      console.error('Error in monthly co-founder penalty application:', error);
      throw error;
    }
  }

  /**
   * Generate weekly statistics for co-founder installments
   */
  async generateWeeklyStats() {
    try {
      const totalPlans = await CoFounderInstallmentPlan.countDocuments();
      const activePlans = await CoFounderInstallmentPlan.countDocuments({
        status: { $in: ['active', 'pending'] }
      });
      const latePlans = await CoFounderInstallmentPlan.countDocuments({
        status: 'late'
      });
      const completedPlans = await CoFounderInstallmentPlan.countDocuments({
        status: 'completed'
      });
      const cancelledPlans = await CoFounderInstallmentPlan.countDocuments({
        status: 'cancelled'
      });

      // Calculate total values
      const allPlans = await CoFounderInstallmentPlan.find({});
      const totalValue = allPlans.reduce((sum, plan) => sum + plan.totalPrice, 0);
      const totalPaid = allPlans.reduce((sum, plan) => sum + (plan.totalPaidAmount || 0), 0);
      const totalPending = totalValue - totalPaid;

      return {
        totalPlans,
        activePlans,
        latePlans,
        completedPlans,
        cancelledPlans,
        totalValue,
        totalPaid,
        totalPending,
        completionRate: totalPlans > 0 ? (completedPlans / totalPlans * 100).toFixed(2) : 0
      };

    } catch (error) {
      console.error('Error generating co-founder weekly stats:', error);
      throw error;
    }
  }

  /**
   * Send late payment notification to user
   */
  async sendLatePaymentNotification(user, plan, overdueInstallments) {
    if (!sendEmail) {
      console.log('Email service not available, skipping notification');
      return;
    }

    const overdueCount = overdueInstallments.length;
    const totalOverdueAmount = overdueInstallments.reduce((sum, inst) => 
      sum + (inst.amount - (inst.paidAmount || 0)), 0
    );
    const totalLateFees = overdueInstallments.reduce((sum, inst) => 
      sum + (inst.lateFee || 0), 0
    );

    await sendEmail({
      email: user.email,
      subject: 'Co-Founder Installment - Late Payment Notice',
      html: `
        <h2>Co-Founder Installment Late Payment Notice</h2>
        <p>Dear ${user.name},</p>
        <p>We noticed that your co-founder installment plan has overdue payments that require immediate attention.</p>
        
        <div style="background-color: #f8f9fa; padding: 15px; margin: 15px 0; border-left: 4px solid #dc3545;">
          <h3>Plan Details:</h3>
          <ul>
            <li>Plan ID: ${plan.planId}</li>
            <li>Total Co-Founder Shares: ${plan.totalShares}</li>
            <li>Overdue Installments: ${overdueCount}</li>
            <li>Overdue Amount: ${plan.currency === 'naira' ? '₦' : '$'}${totalOverdueAmount.toFixed(2)}</li>
            <li>Late Fees: ${plan.currency === 'naira' ? '₦' : '$'}${totalLateFees.toFixed(2)}</li>
          </ul>
        </div>

        <p><strong>Total Amount Due: ${plan.currency === 'naira' ? '₦' : '$'}${(totalOverdueAmount + totalLateFees).toFixed(2)}</strong></p>
        
        <p>Please make a payment as soon as possible to avoid additional late fees. Late fees are calculated at ${plan.lateFeePercentage || 0.5}% per month on the outstanding balance.</p>
        
        <p>You can make payments through your dashboard using Paystack.</p>
        
        <p>If you have any questions or need assistance, please contact our support team.</p>
        
        <p>Best regards,<br>AfriMobile Team</p>
      `
    });
  }

  /**
   * Send monthly penalty notification to user
   */
  async sendMonthlyPenaltyNotification(user, plan, monthlyPenalty) {
    if (!sendEmail) {
      console.log('Email service not available, skipping notification');
      return;
    }

    const remainingBalance = plan.totalPrice - (plan.totalPaidAmount || 0);
    const totalDue = remainingBalance + (plan.currentLateFee || 0);

    await sendEmail({
      email: user.email,
      subject: 'Co-Founder Installment - Monthly Late Fee Applied',
      html: `
        <h2>Monthly Late Fee Applied - Co-Founder Installment</h2>
        <p>Dear ${user.name},</p>
        <p>A monthly late fee has been applied to your co-founder installment plan due to overdue payments.</p>
        
        <div style="background-color: #fff3cd; padding: 15px; margin: 15px 0; border-left: 4px solid #ffc107;">
          <h3>Fee Details:</h3>
          <ul>
            <li>Plan ID: ${plan.planId}</li>
            <li>Monthly Late Fee Applied: ${plan.currency === 'naira' ? '₦' : '$'}${monthlyPenalty.toFixed(2)}</li>
            <li>Total Late Fees: ${plan.currency === 'naira' ? '₦' : '$'}${(plan.currentLateFee || 0).toFixed(2)}</li>
            <li>Remaining Balance: ${plan.currency === 'naira' ? '₦' : '$'}${remainingBalance.toFixed(2)}</li>
            <li>Months Late: ${plan.monthsLate || 1}</li>
          </ul>
        </div>

        <p><strong>Total Amount Due: ${plan.currency === 'naira' ? '₦' : '$'}${totalDue.toFixed(2)}</strong></p>
        
        <p>Late fees are capped at 7.5% of the total plan value. Please make a payment immediately to prevent further penalties.</p>
        
        <p>You can make payments through your dashboard using Paystack.</p>
        
        <p>Best regards,<br>AfriMobile Team</p>
      `
    });
  }

  /**
   * Send weekly admin summary
   */
  async sendWeeklyAdminSummary(penaltyResults, stats) {
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrimobile.com';
      
      await sendEmail({
        email: adminEmail,
        subject: 'Weekly Co-Founder Installment Summary',
        html: `
          <h2>Weekly Co-Founder Installment Summary</h2>
          <p>Here's the weekly summary of co-founder installment activities:</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; margin: 15px 0;">
            <h3>Penalty Check Results:</h3>
            <ul>
              <li>Plans Checked: ${penaltyResults.plansChecked}</li>
              <li>Penalties Applied: ${penaltyResults.penaltiesApplied}</li>
              <li>Notifications Sent: ${penaltyResults.notificationsSent}</li>
            </ul>
          </div>

          <div style="background-color: #e7f3ff; padding: 15px; margin: 15px 0;">
            <h3>Overall Statistics:</h3>
            <ul>
              <li>Total Plans: ${stats.totalPlans}</li>
              <li>Active Plans: ${stats.activePlans}</li>
              <li>Late Plans: ${stats.latePlans}</li>
              <li>Completed Plans: ${stats.completedPlans}</li>
              <li>Cancelled Plans: ${stats.cancelledPlans}</li>
              <li>Completion Rate: ${stats.completionRate}%</li>
              <li>Total Value: ₦${stats.totalValue.toLocaleString()}</li>
              <li>Total Paid: ₦${stats.totalPaid.toLocaleString()}</li>
              <li>Total Pending: ₦${stats.totalPending.toLocaleString()}</li>
            </ul>
          </div>

          <p>Generated on: ${new Date().toISOString()}</p>
        `
      });

      console.log('Weekly admin summary sent successfully');
    } catch (error) {
      console.error('Failed to send weekly admin summary:', error);
    }
  }

  /**
   * Manual trigger for penalty check (for testing/debugging)
   */
  async manualPenaltyCheck() {
    console.log('Manual co-founder penalty check triggered...');
    try {
      const results = await this.checkAndApplyPenalties();
      console.log('Manual co-founder penalty check completed:', results);
      return results;
    } catch (error) {
      console.error('Manual co-founder penalty check failed:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const coFounderInstallmentScheduler = new CoFounderInstallmentScheduler();

module.exports = coFounderInstallmentScheduler;