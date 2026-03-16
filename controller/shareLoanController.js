const ShareLoan = require('../models/ShareLoan');
const UserShare = require('../models/UserShare');

// Helper: get share value per unit (can be adjusted)
const SHARE_VALUE_NAIRA = 5000; // Value per share in Naira

// POST - User requests a loan
exports.requestLoan = async (req, res) => {
  try {
    const { loanAmount, sharesTiedAsCollateral, purpose, repaymentPeriod, bankDetails } = req.body;
    const userId = req.user._id;

    if (!loanAmount || !sharesTiedAsCollateral || !purpose || !repaymentPeriod) {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields' });
    }

    if (![3, 6, 12].includes(Number(repaymentPeriod))) {
      return res.status(400).json({ success: false, message: 'Repayment period must be 3, 6, or 12 months' });
    }

    // Check user's shares
    const userShares = await UserShare.findOne({ user: userId });
    if (!userShares) {
      return res.status(400).json({ success: false, message: 'You do not own any shares' });
    }

    const totalEffectiveShares = userShares.totalShares + (userShares.equivalentRegularShares || 0);

    // Check existing active loans collateral
    const activeLoans = await ShareLoan.find({
      userId,
      status: { $in: ['pending', 'approved', 'active', 'repaying'] }
    });
    const alreadyCollateralized = activeLoans.reduce((sum, loan) => sum + loan.sharesTiedAsCollateral, 0);
    const availableShares = totalEffectiveShares - alreadyCollateralized;

    if (sharesTiedAsCollateral > availableShares) {
      return res.status(400).json({
        success: false,
        message: `Insufficient available shares. You have ${availableShares} shares available (${alreadyCollateralized} already used as collateral)`
      });
    }

    // Calculate collateral value and LTV
    const collateralValue = sharesTiedAsCollateral * SHARE_VALUE_NAIRA;
    const maxLoan = collateralValue * 0.5; // 50% LTV max

    if (loanAmount > maxLoan) {
      return res.status(400).json({
        success: false,
        message: `Loan amount exceeds 50% LTV. Max loan for ${sharesTiedAsCollateral} shares is ₦${maxLoan.toLocaleString()}`
      });
    }

    const loanToValueRatio = loanAmount / collateralValue;
    const interestRate = 5;
    const totalInterest = (loanAmount * interestRate * Number(repaymentPeriod)) / 100;
    const totalRepayment = loanAmount + totalInterest;
    const monthlyRepayment = totalRepayment / Number(repaymentPeriod);

    // Determine collateral tier
    let collateralTier = 'basic';
    if (sharesTiedAsCollateral >= 1000) collateralTier = 'supreme';
    else if (sharesTiedAsCollateral >= 500) collateralTier = 'platinum';
    else if (sharesTiedAsCollateral >= 200) collateralTier = 'elite';
    else if (sharesTiedAsCollateral >= 100) collateralTier = 'premium';
    else if (sharesTiedAsCollateral >= 50) collateralTier = 'standard';

    const loan = await ShareLoan.create({
      userId,
      loanAmount,
      sharesTiedAsCollateral,
      collateralTier,
      collateralValue,
      loanToValueRatio,
      purpose,
      repaymentPeriod: Number(repaymentPeriod),
      interestRate,
      totalRepayment,
      monthlyRepayment,
      bankDetails: bankDetails || {}
    });

    res.status(201).json({ success: true, message: 'Loan request submitted successfully', data: loan });
  } catch (error) {
    console.error('Request loan error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit loan request', error: error.message });
  }
};

// GET - User gets their loans
exports.getMyLoans = async (req, res) => {
  try {
    const loans = await ShareLoan.find({ userId: req.user._id }).sort({ createdAt: -1 });

    // Also get available shares info
    const userShares = await UserShare.findOne({ user: req.user._id });
    const totalEffectiveShares = userShares ? (userShares.totalShares + (userShares.equivalentRegularShares || 0)) : 0;

    const activeLoans = loans.filter(l => ['pending', 'approved', 'active', 'repaying'].includes(l.status));
    const collateralized = activeLoans.reduce((sum, l) => sum + l.sharesTiedAsCollateral, 0);

    res.json({
      success: true,
      data: loans,
      shareInfo: {
        totalShares: totalEffectiveShares,
        collateralized,
        available: totalEffectiveShares - collateralized,
        shareValue: SHARE_VALUE_NAIRA,
        maxLoanAmount: (totalEffectiveShares - collateralized) * SHARE_VALUE_NAIRA * 0.5
      }
    });
  } catch (error) {
    console.error('Get my loans error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch loans', error: error.message });
  }
};

// GET - Admin lists all loans
exports.adminGetAllLoans = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (search) {
      // We'll search by populated user fields via a different approach
      filter.$or = [
        { purpose: { $regex: search, $options: 'i' } },
        { 'bankDetails.accountName': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [loans, total] = await Promise.all([
      ShareLoan.find(filter)
        .populate('userId', 'name email phone')
        .populate('approvedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ShareLoan.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: loans,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    console.error('Admin get all loans error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch loans', error: error.message });
  }
};

// POST - Admin approves a loan
exports.adminApproveLoan = async (req, res) => {
  try {
    const loan = await ShareLoan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    if (loan.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending loans can be approved' });
    }

    loan.status = 'approved';
    loan.approvedBy = req.user._id;
    loan.approvedAt = new Date();
    if (req.body.adminNotes) loan.adminNotes = req.body.adminNotes;

    await loan.save();
    res.json({ success: true, message: 'Loan approved successfully', data: loan });
  } catch (error) {
    console.error('Admin approve loan error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve loan', error: error.message });
  }
};

// POST - Admin rejects a loan
exports.adminRejectLoan = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const loan = await ShareLoan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    if (loan.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending loans can be rejected' });
    }

    loan.status = 'rejected';
    loan.rejectionReason = rejectionReason || 'No reason provided';
    if (req.body.adminNotes) loan.adminNotes = req.body.adminNotes;

    await loan.save();
    res.json({ success: true, message: 'Loan rejected', data: loan });
  } catch (error) {
    console.error('Admin reject loan error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject loan', error: error.message });
  }
};

// POST - Admin disburses an approved loan
exports.adminDisburseLoan = async (req, res) => {
  try {
    const loan = await ShareLoan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    if (loan.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved loans can be disbursed' });
    }

    loan.status = 'active';
    loan.disbursedAt = new Date();
    loan.repaymentStartDate = new Date();

    // Set next payment due to 1 month from now
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + 1);
    loan.nextPaymentDue = nextDue;

    if (req.body.adminNotes) loan.adminNotes = req.body.adminNotes;

    await loan.save();
    res.json({ success: true, message: 'Loan disbursed successfully', data: loan });
  } catch (error) {
    console.error('Admin disburse loan error:', error);
    res.status(500).json({ success: false, message: 'Failed to disburse loan', error: error.message });
  }
};

// POST - Admin records a repayment
exports.recordRepayment = async (req, res) => {
  try {
    const { amount, reference, method } = req.body;
    const loan = await ShareLoan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    if (!['active', 'repaying'].includes(loan.status)) {
      return res.status(400).json({ success: false, message: 'Repayments can only be recorded for active/repaying loans' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid repayment amount is required' });
    }

    loan.repayments.push({
      amount: Number(amount),
      date: new Date(),
      reference: reference || '',
      method: method || 'bank_transfer'
    });

    loan.totalRepaid += Number(amount);
    loan.status = 'repaying';

    // Check if fully repaid
    if (loan.totalRepaid >= loan.totalRepayment) {
      loan.status = 'completed';
    } else {
      // Set next payment due
      const nextDue = new Date();
      nextDue.setMonth(nextDue.getMonth() + 1);
      loan.nextPaymentDue = nextDue;
    }

    if (req.body.adminNotes) loan.adminNotes = req.body.adminNotes;

    await loan.save();
    res.json({ success: true, message: 'Repayment recorded successfully', data: loan });
  } catch (error) {
    console.error('Record repayment error:', error);
    res.status(500).json({ success: false, message: 'Failed to record repayment', error: error.message });
  }
};

// GET - Admin gets loan stats
exports.adminGetLoanStats = async (req, res) => {
  try {
    const [statusStats, total] = await Promise.all([
      ShareLoan.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$loanAmount' },
            totalRepaid: { $sum: '$totalRepaid' }
          }
        }
      ]),
      ShareLoan.countDocuments()
    ]);

    const byStatus = {};
    let totalLentOut = 0;
    let totalRepaidAmount = 0;

    statusStats.forEach(s => {
      byStatus[s._id] = { count: s.count, totalAmount: s.totalAmount, totalRepaid: s.totalRepaid };
      if (['active', 'repaying', 'completed'].includes(s._id)) {
        totalLentOut += s.totalAmount;
        totalRepaidAmount += s.totalRepaid;
      }
    });

    const repaymentRate = totalLentOut > 0 ? ((totalRepaidAmount / totalLentOut) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        total,
        byStatus,
        totalLentOut,
        totalRepaidAmount,
        repaymentRate: Number(repaymentRate)
      }
    });
  } catch (error) {
    console.error('Admin get loan stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch loan stats', error: error.message });
  }
};
