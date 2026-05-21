// utils/installmentReminder.js - Installment Reminder & Auto-Forfeit System
const cron = require('node-cron');
const InstallmentPlan = require('../models/InstallmentPlan');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

async function checkAndSendReminders() {
  try {
    const activePlans = await InstallmentPlan.find({ status: 'active' }).populate('user', 'name email');
    const now = new Date();

    for (const plan of activePlans) {
      if (!plan.user?.email) continue;

      const created = plan.createdAt;
      const deadline = plan.deadline;
      const totalDuration = deadline - created;
      const elapsed = now - created;
      const percentElapsed = (elapsed / totalDuration) * 100;

      // Determine if we should send a reminder (at 50%, 75%, 90%)
      const thresholds = [50, 75, 90];
      const lastSent = plan.lastReminderSent;
      const hoursSinceLastReminder = lastSent ? (now - lastSent) / (1000 * 60 * 60) : 999;

      // Only send once per threshold, minimum 24h between reminders
      if (hoursSinceLastReminder < 24) continue;

      let shouldSend = false;
      let urgency = '';

      for (const t of thresholds) {
        if (percentElapsed >= t && percentElapsed < t + 10) {
          shouldSend = true;
          if (t >= 90) urgency = '🚨 URGENT';
          else if (t >= 75) urgency = '⚠️ Important';
          else urgency = '📋 Reminder';
          break;
        }
      }

      if (!shouldSend) continue;

      const totalPaid = plan.payments.filter(p => p.status === 'approved').reduce((s, p) => s + p.amount, 0);
      const remaining = plan.totalPrice - totalPaid;
      const daysLeft = Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));

      try {
        await sendEmail({
          email: plan.user.email,
          subject: `${urgency} AfriMobile - Complete Your ${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)} Installment Payment`,
          html: `
            <h2>${urgency} Installment Payment Reminder</h2>
            <p>Hello ${plan.user.name || 'there'},</p>
            <p>This is a reminder about your <strong>${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}</strong> tier installment plan.</p>
            <table style="border-collapse:collapse;width:100%;max-width:400px;margin:16px 0">
              <tr><td style="padding:8px;border:1px solid #ddd"><strong>Total Price</strong></td><td style="padding:8px;border:1px solid #ddd">₦${plan.totalPrice.toLocaleString()}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><strong>Amount Paid</strong></td><td style="padding:8px;border:1px solid #ddd">₦${totalPaid.toLocaleString()}</td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><strong>Remaining</strong></td><td style="padding:8px;border:1px solid #ddd;color:red"><strong>₦${remaining.toLocaleString()}</strong></td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><strong>Days Left</strong></td><td style="padding:8px;border:1px solid #ddd"><strong>${daysLeft} days</strong></td></tr>
              <tr><td style="padding:8px;border:1px solid #ddd"><strong>Deadline</strong></td><td style="padding:8px;border:1px solid #ddd">${deadline.toLocaleDateString()}</td></tr>
            </table>
            <p style="color:red"><strong>If payment is not completed by the deadline, your shares will be forfeited.</strong></p>
            <p>Log in to your dashboard to make a payment now.</p>
            <p>Thank you,<br/>AfriMobile Team</p>
          `
        });

        plan.lastReminderSent = now;
        await plan.save();
        console.log(`[INSTALLMENT-REMINDER] Sent reminder to ${plan.user.email} for plan ${plan._id}`);
      } catch (e) {
        console.error(`[INSTALLMENT-REMINDER] Failed to send reminder:`, e.message);
      }
    }
  } catch (error) {
    console.error('[INSTALLMENT-REMINDER] Error checking reminders:', error.message);
  }
}

async function autoForfeitExpired() {
  try {
    const now = new Date();
    const expiredPlans = await InstallmentPlan.find({
      status: 'active',
      deadline: { $lt: now }
    }).populate('user', 'name email');

    for (const plan of expiredPlans) {
      plan.status = 'forfeited';
      plan.forfeitedAt = now;
      await plan.save();

      console.log(`[INSTALLMENT-FORFEIT] Auto-forfeited plan ${plan._id} for user ${plan.user?._id}`);

      if (plan.user?.email) {
        try {
          await sendEmail({
            email: plan.user.email,
            subject: 'AfriMobile - Installment Plan Forfeited',
            html: `
              <h2>Installment Plan Forfeited</h2>
              <p>Hello ${plan.user.name || 'there'},</p>
              <p>Your installment plan for the <strong>${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}</strong> tier has been forfeited because the deadline has passed.</p>
              <p>Please contact support if you believe this is an error or wish to discuss options.</p>
              <p>AfriMobile Team</p>
            `
          });
        } catch (e) { console.error('Email error:', e.message); }
      }
    }

    if (expiredPlans.length > 0) {
      console.log(`[INSTALLMENT-FORFEIT] Auto-forfeited ${expiredPlans.length} expired plans`);
    }
  } catch (error) {
    console.error('[INSTALLMENT-FORFEIT] Error auto-forfeiting:', error.message);
  }
}

// Schedule daily at 9 AM
function startInstallmentReminderScheduler() {
  const job = cron.schedule('0 9 * * *', async () => {
    console.log('[INSTALLMENT-SCHEDULER] Running daily installment checks...');
    await checkAndSendReminders();
    await autoForfeitExpired();
    console.log('[INSTALLMENT-SCHEDULER] Daily checks complete.');
  });

  console.log('✅ Installment reminder scheduler started (daily at 9 AM)');
  return job;
}

module.exports = { startInstallmentReminderScheduler, checkAndSendReminders, autoForfeitExpired };
