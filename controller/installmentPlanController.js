// controller/installmentPlanController.js - Unified Installment Plan System
const InstallmentPlan = require('../models/InstallmentPlan');
const { SHARE_TIERS } = require('../models/Share');
const Share = require('../models/Share');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const PaymentTransaction = require('../models/Transaction');
const { sendEmail } = require('../utils/emailService');
const { processReferralCommission } = require('../utils/referralUtils');
const crypto = require('crypto');

const generateTransactionId = () => {
  return `INST-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;
};

const TIER_CONFIG = {
  basic:    { type: 'regular',   priceNGN: 30000,   sharesIncluded: 1 },
  standard: { type: 'regular',   priceNGN: 50000,   sharesIncluded: 1 },
  premium:  { type: 'regular',   priceNGN: 100000,  sharesIncluded: 1 },
  elite:    { type: 'cofounder', priceNGN: 1000000,  sharesIncluded: 22 },
  platinum: { type: 'cofounder', priceNGN: 2500000,  sharesIncluded: 27 },
  supreme:  { type: 'cofounder', priceNGN: 5000000,  sharesIncluded: 60 },
};

// POST /api/installments/create
exports.createPlan = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tier, downPaymentAmount, currency, method, reference, proofUrl } = req.body;

    if (!tier || !TIER_CONFIG[tier]) {
      return res.status(400).json({ success: false, message: 'Invalid tier. Must be one of: basic, standard, premium, elite, platinum, supreme' });
    }

    const tierInfo = TIER_CONFIG[tier];
    const totalPrice = tierInfo.priceNGN;
    const minDown = Math.ceil(totalPrice * 0.3);

    if (!downPaymentAmount || downPaymentAmount < minDown) {
      return res.status(400).json({
        success: false,
        message: `Minimum down payment is 30% (₦${minDown.toLocaleString()})`,
        minDownPayment: minDown,
        totalPrice
      });
    }

    if (downPaymentAmount > totalPrice) {
      return res.status(400).json({ success: false, message: 'Down payment cannot exceed total price' });
    }

    // Check for existing active plan for same tier
    const existing = await InstallmentPlan.findOne({
      user: userId,
      tier,
      status: { $in: ['pending_downpayment', 'active'] }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have an active installment plan for this tier' });
    }

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 90);

    // Handle file upload
    let proofPath = proofUrl || '';
    if (req.file) {
      proofPath = req.file.path || `/uploads/installment-proofs/${req.file.filename}`;
    }

    const plan = await InstallmentPlan.create({
      user: userId,
      tier,
      tierType: tierInfo.type,
      totalPrice,
      currency: currency || 'naira',
      downPayment: downPaymentAmount,
      payments: [{
        amount: downPaymentAmount,
        date: new Date(),
        method: method || 'bank_transfer',
        reference: reference || generateTransactionId(),
        proofPath,
        status: 'pending'
      }],
      status: 'pending_downpayment',
      deadline
    });

    // Send confirmation email
    const user = await User.findById(userId);
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Installment Plan Created',
          html: `
            <h2>Installment Plan Created Successfully</h2>
            <p>Hello ${user.name || 'there'},</p>
            <p>Your installment plan for the <strong>${tier.charAt(0).toUpperCase() + tier.slice(1)}</strong> tier has been created.</p>
            <ul>
              <li><strong>Total Price:</strong> ₦${totalPrice.toLocaleString()}</li>
              <li><strong>Down Payment:</strong> ₦${downPaymentAmount.toLocaleString()}</li>
              <li><strong>Remaining Balance:</strong> ₦${(totalPrice - downPaymentAmount).toLocaleString()}</li>
              <li><strong>Deadline:</strong> ${deadline.toLocaleDateString()}</li>
            </ul>
            <p>Your down payment is pending admin approval. You'll be notified once it's reviewed.</p>
            <p>Complete your balance within 90 days to secure your shares.</p>
          `
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    res.status(201).json({
      success: true,
      message: 'Installment plan created. Down payment pending approval.',
      plan
    });
  } catch (error) {
    console.error('Error creating installment plan:', error);
    res.status(500).json({ success: false, message: 'Failed to create installment plan', error: error.message });
  }
};

// GET /api/installments/my-plans
exports.getMyPlans = async (req, res) => {
  try {
    const plans = await InstallmentPlan.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plans' });
  }
};

// GET /api/installments/my-plans/:planId
exports.getPlanDetails = async (req, res) => {
  try {
    const plan = await InstallmentPlan.findOne({ _id: req.params.planId, user: req.user.id });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true, plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plan' });
  }
};

// POST /api/installments/pay/:planId
exports.makePayment = async (req, res) => {
  try {
    const { amount, method, reference, proofUrl } = req.body;
    const plan = await InstallmentPlan.findOne({ _id: req.params.planId, user: req.user.id });

    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    if (plan.status !== 'active') {
      return res.status(400).json({ success: false, message: `Cannot make payment on a ${plan.status} plan` });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const remaining = plan.remainingBalance;
    if (amount > remaining) {
      return res.status(400).json({ success: false, message: `Payment exceeds remaining balance of ₦${remaining.toLocaleString()}` });
    }

    let proofPath = proofUrl || '';
    if (req.file) {
      proofPath = req.file.path || `/uploads/installment-proofs/${req.file.filename}`;
    }

    plan.payments.push({
      amount,
      date: new Date(),
      method: method || 'bank_transfer',
      reference: reference || generateTransactionId(),
      proofPath,
      status: 'pending'
    });

    await plan.save();

    res.json({ success: true, message: 'Payment submitted, pending admin approval.', plan });
  } catch (error) {
    console.error('Error making payment:', error);
    res.status(500).json({ success: false, message: 'Failed to submit payment' });
  }
};

// GET /api/installments/admin/all
exports.adminGetAll = async (req, res) => {
  try {
    const { status, tier, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (tier) filter.tier = tier;

    let query = InstallmentPlan.find(filter)
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    let plans = await query;
    const total = await InstallmentPlan.countDocuments(filter);

    // Search filter (post-query for populated fields)
    if (search) {
      const s = search.toLowerCase();
      plans = plans.filter(p =>
        p.user?.name?.toLowerCase().includes(s) ||
        p.user?.email?.toLowerCase().includes(s)
      );
    }

    res.json({ success: true, plans, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin get all installments error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch installment plans' });
  }
};

// GET /api/installments/admin/:planId
exports.adminGetPlan = async (req, res) => {
  try {
    const plan = await InstallmentPlan.findById(req.params.planId).populate('user', 'name email phone');
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true, plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plan' });
  }
};

// PUT /api/installments/admin/:planId/approve-payment/:paymentIndex
exports.adminApprovePayment = async (req, res) => {
  try {
    const { planId, paymentIndex } = req.params;
    const { adminNote } = req.body;
    const plan = await InstallmentPlan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const idx = parseInt(paymentIndex);
    if (!plan.payments[idx]) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (plan.payments[idx].status !== 'pending') {
      return res.status(400).json({ success: false, message: `Payment already ${plan.payments[idx].status}` });
    }

    plan.payments[idx].status = 'approved';
    plan.payments[idx].adminNote = adminNote || '';
    plan.payments[idx].reviewedAt = new Date();
    plan.payments[idx].reviewedBy = req.user.id;

    // If this was the down payment (first payment), activate the plan
    if (plan.status === 'pending_downpayment' && idx === 0) {
      plan.status = 'active';
    }

    await plan.save();

    // Check if plan is now fully paid
    const totalApproved = plan.payments
      .filter(p => p.status === 'approved')
      .reduce((sum, p) => sum + p.amount, 0);

    if (totalApproved >= plan.totalPrice) {
      await completePlan(plan);
    }

    res.json({ success: true, message: 'Payment approved', plan });
  } catch (error) {
    console.error('Error approving payment:', error);
    res.status(500).json({ success: false, message: 'Failed to approve payment' });
  }
};

// PUT /api/installments/admin/:planId/reject-payment/:paymentIndex
exports.adminRejectPayment = async (req, res) => {
  try {
    const { planId, paymentIndex } = req.params;
    const { adminNote } = req.body;
    const plan = await InstallmentPlan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const idx = parseInt(paymentIndex);
    if (!plan.payments[idx]) return res.status(404).json({ success: false, message: 'Payment not found' });

    plan.payments[idx].status = 'rejected';
    plan.payments[idx].adminNote = adminNote || '';
    plan.payments[idx].reviewedAt = new Date();
    plan.payments[idx].reviewedBy = req.user.id;

    await plan.save();

    // Notify user
    const user = await User.findById(plan.user);
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Installment Payment Rejected',
          html: `
            <h2>Payment Rejected</h2>
            <p>Hello ${user.name || 'there'},</p>
            <p>Your payment of ₦${plan.payments[idx].amount.toLocaleString()} for the ${plan.tier} installment plan was rejected.</p>
            ${adminNote ? `<p><strong>Reason:</strong> ${adminNote}</p>` : ''}
            <p>Please resubmit with correct payment proof.</p>
          `
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    res.json({ success: true, message: 'Payment rejected', plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reject payment' });
  }
};

// PUT /api/installments/admin/:planId/forfeit
exports.adminForfeitPlan = async (req, res) => {
  try {
    const plan = await InstallmentPlan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
    if (plan.status === 'completed') return res.status(400).json({ success: false, message: 'Cannot forfeit a completed plan' });

    plan.status = 'forfeited';
    plan.forfeitedAt = new Date();
    await plan.save();

    const user = await User.findById(plan.user);
    if (user?.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Installment Plan Forfeited',
          html: `
            <h2>Installment Plan Forfeited</h2>
            <p>Hello ${user.name || 'there'},</p>
            <p>Your installment plan for the <strong>${plan.tier}</strong> tier has been forfeited due to incomplete payment.</p>
            <p>Please contact support if you believe this is an error.</p>
          `
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    res.json({ success: true, message: 'Plan forfeited', plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to forfeit plan' });
  }
};

// GET /api/installments/admin/stats
exports.adminGetStats = async (req, res) => {
  try {
    const [totalPlans, activePlans, completedPlans, forfeitedPlans, pendingPlans] = await Promise.all([
      InstallmentPlan.countDocuments(),
      InstallmentPlan.countDocuments({ status: 'active' }),
      InstallmentPlan.countDocuments({ status: 'completed' }),
      InstallmentPlan.countDocuments({ status: 'forfeited' }),
      InstallmentPlan.countDocuments({ status: 'pending_downpayment' }),
    ]);

    // Total revenue from approved payments
    const revenueAgg = await InstallmentPlan.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.status': 'approved' } },
      { $group: { _id: null, total: { $sum: '$payments.amount' } } }
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    // Plans by tier
    const byTier = await InstallmentPlan.aggregate([
      { $group: { _id: '$tier', count: { $sum: 1 } } }
    ]);

    // Pending payments count
    const pendingPayments = await InstallmentPlan.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.status': 'pending' } },
      { $count: 'count' }
    ]);

    res.json({
      success: true,
      stats: {
        totalPlans,
        activePlans,
        completedPlans,
        forfeitedPlans,
        pendingPlans,
        totalRevenue,
        pendingPaymentsCount: pendingPayments[0]?.count || 0,
        byTier: byTier.reduce((acc, t) => { acc[t._id] = t.count; return acc; }, {})
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statistics' });
  }
};

// Helper: Complete an installment plan (assign shares)
async function completePlan(plan) {
  try {
    plan.status = 'completed';
    plan.completedAt = new Date();

    const tierInfo = SHARE_TIERS[plan.tier];
    if (!tierInfo) {
      console.error(`Unknown tier: ${plan.tier}`);
      await plan.save();
      return;
    }

    const user = await User.findById(plan.user);
    if (!user) { await plan.save(); return; }

    const transactionId = generateTransactionId();
    const shares = tierInfo.sharesIncluded;

    // Create share purchase transaction record
    const transaction = await PaymentTransaction.create({
      transactionId,
      userId: plan.user,
      type: plan.tierType === 'cofounder' ? 'cofounder' : 'share',
      tier: plan.tier,
      shares,
      amount: plan.totalPrice,
      currency: 'naira',
      paymentMethod: 'installment',
      status: 'completed',
      adminNotes: `Completed via installment plan ${plan._id}`
    });

    // Update or create UserShare record
    let userShare = await UserShare.findOne({ user: plan.user });
    if (!userShare) {
      userShare = new UserShare({
        user: plan.user,
        totalShares: shares,
        verifiedShares: shares,
        transactions: [{
          transactionId,
          shares,
          amount: plan.totalPrice,
          tier: plan.tier,
          status: 'completed',
          date: new Date()
        }]
      });
    } else {
      userShare.totalShares = (userShare.totalShares || 0) + shares;
      userShare.verifiedShares = (userShare.verifiedShares || 0) + shares;
      userShare.transactions.push({
        transactionId,
        shares,
        amount: plan.totalPrice,
        tier: plan.tier,
        status: 'completed',
        date: new Date()
      });
    }
    await userShare.save();

    // Update global share counts
    try {
      const shareConfig = await Share.getCurrentConfig();
      shareConfig.sharesSold = (shareConfig.sharesSold || 0) + shares;
      const tierKey = `${plan.tier}Sold`;
      if (shareConfig.tierSales && typeof shareConfig.tierSales[tierKey] !== 'undefined') {
        shareConfig.tierSales[tierKey] += shares;
      }
      await shareConfig.save();
    } catch (e) { console.error('Error updating share config:', e.message); }

    // Process referral commission
    try {
      await processReferralCommission(plan.user, plan.totalPrice, plan.tierType === 'cofounder' ? 'cofounder' : 'share', transactionId);
    } catch (e) { console.error('Referral error:', e.message); }

    plan.shareRecordId = userShare._id;
    await plan.save();

    // Send completion email
    if (user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'AfriMobile - Installment Complete! Shares Assigned 🎉',
          html: `
            <h2>Congratulations! 🎉</h2>
            <p>Hello ${user.name || 'there'},</p>
            <p>Your installment plan for the <strong>${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}</strong> tier is now <strong>fully paid</strong>!</p>
            <p><strong>${shares} share${shares > 1 ? 's' : ''}</strong> have been assigned to your account.</p>
            <p>Thank you for investing in AfriMobile!</p>
          `
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    console.log(`✅ Installment plan ${plan._id} completed. ${shares} shares assigned to user ${plan.user}`);
  } catch (error) {
    console.error('Error completing installment plan:', error);
  }
}
