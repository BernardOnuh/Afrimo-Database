/**
 * Franchise Controller - Recharge-Card Reseller Model
 *
 * Franchise packages (cost → credit):
 *   Starter:    ₦800k  → ₦1M  credit
 *   Standard:   ₦1.5M  → ₦2M  credit
 *   Pro:        ₦2M    → ₦3M  credit
 *   Enterprise: ₦5M    → ₦8M  credit
 *
 * Key rules:
 *  - Registration is instant (no admin approval for the franchise itself)
 *  - Admin only approves the credit purchase (payment proof)
 *  - Franchise sells at COMPANY PRICES only
 *  - Buyer pays franchise directly, uploads proof
 *  - Franchise approves → credit deducted → shares released to buyer
 *  - Franchise CAN buy for themselves (self-purchase)
 *  - NO referral commissions on franchise transactions
 */

const Franchise        = require('../models/Franchise');
const FranchiseTx      = require('../models/FranchiseTransaction');
const User             = require('../models/User');
const UserShare        = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const { sendEmail }    = require('../utils/emailService');
const { deleteFromCloudinary } = require('../config/cloudinary');
const crypto           = require('crypto');
const TransactionV2        = require('../models/TransactionV2');
const UserShareV2          = require('../models/UserShareV2');
const writeToV2            = require('../helpers/writeToV2');
const recalculateUserShare = require('../helpers/recalculateUserShare');

const genTxId  = (prefix = 'FRN') =>
  `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

// ─── Helper: resolve TierConfig ───────────────────────────────────────────────
// ─── Helper: resolve TierConfig ───────────────────────────────────────────────
const getTierData = async (tierKey) => {
  const TierConfig = require('../models/TierConfig');
  const config = await TierConfig.getCurrentConfig();

  if (!config.tiers.has(tierKey)) return null;
  const t = config.tiers.get(tierKey);
console.log('Full tier object:', JSON.stringify(t));

  // Normalize all DB variants → canonical types
  const typeMap = {
    'regular':    'share',
    'share':      'share',
    'cofounder':  'co-founder',   // ← the actual DB value
    'co-founder': 'co-founder',
  };

  const normalizedType = typeMap[t.type] ?? null;

  if (!normalizedType || t.active === false) return null;

  return { ...(t.toObject ? t.toObject() : t), type: normalizedType };
};

// ─── Helper: release shares to a user (no referral commissions) ───────────────
const releaseShares = async ({ userId, tierKey, tierData, companyPrice, currency, transactionId, source }) => {
  const type = tierData.type === 'co-founder' ? 'co-founder' : 'share';

  const txData = {
    transactionId,
    type,
    tierKey,
    packageId    : tierKey,
    packageLabel : tierData.name,
    ownershipPct : tierData.percentPerShare,   // per-share
    earningKobo  : tierData.earningPerPhone,   // per-share
    shares       : tierData.sharesIncluded || 1,
    amount       : companyPrice,
    totalAmount  : companyPrice,
    currency,
    paymentMethod: source === 'franchise_self' ? 'franchise_credit' : 'franchise',
    status       : 'completed',
  };

  // ── V1 ────────────────────────────────────────────────────────────────────
  await PaymentTransaction.create({ userId, ...txData });
  await UserShare.addTransaction(userId, txData);
  await UserShare.approveTransaction(userId, transactionId);

  // ── V2 ────────────────────────────────────────────────────────────────────
  await writeToV2({ ...txData, userId });
};
// ═══════════════════════════════════════════════════════════════════
// PUBLIC
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /franchise/packages
 * Returns available franchise packages (what you buy to become a reseller)
 */
exports.getPackages = (req, res) => {
  const pkgs = Franchise.getPackages();
  const list = Object.entries(pkgs).map(([key, p]) => ({
    key,
    label:        p.label,
    costNaira:    p.costNaira,
    creditNaira:  p.creditNaira,
    margin:       p.creditNaira - p.costNaira,
    marginPct:    (((p.creditNaira - p.costNaira) / p.costNaira) * 100).toFixed(1) + '%',
  }));
  res.json({ success: true, packages: list });
};

/**
 * GET /franchise/list
 * Public list of active franchises (for buyers choosing where to buy)
 */
exports.listFranchises = async (req, res) => {
  try {
    const franchises = await Franchise.find({ status: 'active' })
      .populate('user', 'name username email')
      .select('businessName businessDescription creditBalance totalSales user bankDetails')
      .lean();

    const result = franchises.map(f => ({
      _id:                 f._id,
      businessName:        f.businessName,
      businessDescription: f.businessDescription,
      creditBalance:       f.creditBalance,        // ← already here, good
      totalSales:          f.totalSales,
      vendor: {
        name:     f.user.name,
        username: f.user.username,
      },
      bankDetails: f.bankDetails,
    }));

    res.json({ success: true, franchises: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /franchise/:franchiseId/detail
 * Full detail of one franchise (for buyer's purchase page)
 */
exports.getFranchiseDetail = async (req, res) => {
  try {
    const franchise = await Franchise.findById(req.params.franchiseId)
      .populate('user', 'name username email')
      .lean();

    if (!franchise || franchise.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Franchise not found or inactive' });
    }

    res.json({
      success: true,
      franchise: {
        _id:             franchise._id,
        businessName:    franchise.businessName,
        businessDescription: franchise.businessDescription,
        creditBalance:   franchise.creditBalance,
        totalSales:      franchise.totalSales,
        bankDetails:     franchise.bankDetails,
        vendor: {
          name:     franchise.user.name,
          username: franchise.user.username,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════
// FRANCHISE VENDOR — REGISTRATION (merged apply + buy-credit)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /franchise/register
 *
 * One-step franchise registration:
 *   1. Creates the franchise account and sets it ACTIVE immediately
 *   2. Submits the credit purchase for admin approval
 *
 * Admin only needs to approve the payment proof — they do NOT need to
 * approve the franchise account itself.
 */
exports.registerFranchise = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      businessName,
      businessDescription,
      bankName,
      accountNumber,
      accountName,
      packageKey,
      paymentMethod,
    } = req.body;

    // ── Validate required fields ──────────────────────────────────
    if (!businessName || !bankName || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'businessName, bankName, accountNumber and accountName are required',
      });
    }

    if (!packageKey) {
      return res.status(400).json({
        success: false,
        message: 'packageKey is required',
        validKeys: Object.keys(Franchise.getPackages()),
      });
    }

    const pkg = Franchise.getPackage(packageKey);
    if (!pkg) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package key',
        validKeys: Object.keys(Franchise.getPackages()),
      });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Payment proof is required' });
    }

    // ── Check for existing franchise ──────────────────────────────
    const existing = await Franchise.findOne({ user: userId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have a franchise account',
        status:       existing.status,
        franchiseId:  existing._id,
      });
    }

    // ── Create franchise (immediately ACTIVE) ─────────────────────
    const transactionId = genTxId('FRC');

    const franchise = await Franchise.create({
      user:               userId,
      businessName,
      businessDescription,
      bankDetails:        { bankName, accountNumber, accountName },
      status:             'active',        // ← no waiting for admin approval
      approvedAt:         new Date(),
      creditPurchases: [{
        transactionId,
        packageKey,
        packageLabel:              pkg.label,
        costNaira:                 pkg.costNaira,
        creditNaira:               pkg.creditNaira,
        paymentMethod:             paymentMethod || 'bank_transfer',
        paymentProofPath:          req.file.path,
        paymentProofCloudinaryUrl: req.file.path,
        paymentProofCloudinaryId:  req.file.filename,
        paymentProofOriginalName:  req.file.originalname,
        paymentProofFileSize:      req.file.size,
        status: 'pending',         // ← admin approves payment separately
      }],
    });

    // ── Notify admins to approve the credit payment ───────────────
    try {
      const user   = await User.findById(userId);
      const admins = await User.find({ isAdmin: true, email: { $exists: true } });
      for (const admin of admins) {
        await sendEmail({
          email:   admin.email,
          subject: 'New Franchise Registration — Credit Approval Required',
          html: `
            <h2>New Franchise Registration</h2>
            <p>A new franchise has registered and their credit purchase requires approval.</p>
            <table cellpadding="8" style="border-collapse:collapse">
              <tr><td><strong>Franchise:</strong></td><td>${businessName}</td></tr>
              <tr><td><strong>Owner:</strong></td><td>${user?.name} (${user?.email})</td></tr>
              <tr><td><strong>Package:</strong></td><td>${pkg.label}</td></tr>
              <tr><td><strong>Cost paid:</strong></td><td>₦${pkg.costNaira.toLocaleString()}</td></tr>
              <tr><td><strong>Credit to add:</strong></td><td>₦${pkg.creditNaira.toLocaleString()}</td></tr>
              <tr><td><strong>Transaction ID:</strong></td><td>${transactionId}</td></tr>
            </table>
            <p><a href="${req.file.path}">View Payment Proof</a></p>
            <p>The franchise account is already active. Approve the payment to credit their balance.</p>
          `,
        });
      }
    } catch (e) {
      console.error('Admin email failed:', e.message);
    }

    res.status(201).json({
      success: true,
      message: 'Franchise account created. Your payment proof has been submitted for admin approval. You can start operating once credit is approved.',
      data: {
        franchiseId:   franchise._id,
        businessName:  franchise.businessName,
        status:        franchise.status,
        creditPurchase: {
          transactionId,
          packageLabel: pkg.label,
          costNaira:    pkg.costNaira,
          creditToAdd:  pkg.creditNaira,
          status:       'pending',
        },
      },
    });
  } catch (err) {
    console.error('registerFranchise error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /franchise/my-profile
 */
exports.getMyFranchise = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id }).lean();
    if (!franchise) {
      return res.status(404).json({ success: false, message: 'No franchise found', isFranchise: false });
    }
    res.json({ success: true, isFranchise: true, data: franchise });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/bank-details
 */
exports.updateBankDetails = async (req, res) => {
  try {
    const { bankName, accountNumber, accountName } = req.body;
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(404).json({ success: false, message: 'Active franchise not found' });

    franchise.bankDetails = { bankName, accountNumber, accountName };
    await franchise.save();
    res.json({ success: true, message: 'Bank details updated', data: franchise.bankDetails });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════
// FRANCHISE VENDOR — BUY MORE CREDIT (existing franchises only)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /franchise/buy-credit
 * Existing active franchise tops up their credit balance.
 * Payment proof uploaded → admin approves → credit added.
 */
exports.buyCredit = async (req, res) => {
  try {
    const userId = req.user.id;
    const { packageKey, paymentMethod } = req.body;

    // Must already be an active franchise (new users should use /register)
    const franchise = await Franchise.findOne({ user: userId });
    if (!franchise) {
      return res.status(403).json({
        success: false,
        message: 'You do not have a franchise account. Use POST /franchise/register to get started.',
      });
    }

    if (franchise.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Franchise is ${franchise.status}. Contact support.`,
      });
    }

    const pkg = Franchise.getPackage(packageKey);
    if (!pkg) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package key',
        validKeys: Object.keys(Franchise.getPackages()),
      });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Payment proof is required' });
    }

    const transactionId = genTxId('FRC');

    franchise.creditPurchases.push({
      transactionId,
      packageKey,
      packageLabel:              pkg.label,
      costNaira:                 pkg.costNaira,
      creditNaira:               pkg.creditNaira,
      paymentMethod:             paymentMethod || 'bank_transfer',
      paymentProofPath:          req.file.path,
      paymentProofCloudinaryUrl: req.file.path,
      paymentProofCloudinaryId:  req.file.filename,
      paymentProofOriginalName:  req.file.originalname,
      paymentProofFileSize:      req.file.size,
      status: 'pending',
    });

    await franchise.save();

    // Notify admins
    try {
      const user   = await User.findById(userId);
      const admins = await User.find({ isAdmin: true, email: { $exists: true } });
      for (const admin of admins) {
        await sendEmail({
          email:   admin.email,
          subject: 'Franchise Credit Top-Up — Approval Required',
          html: `
            <h2>Franchise Credit Top-Up</h2>
            <table cellpadding="8" style="border-collapse:collapse">
              <tr><td><strong>Franchise:</strong></td><td>${franchise.businessName}</td></tr>
              <tr><td><strong>Owner:</strong></td><td>${user?.name} (${user?.email})</td></tr>
              <tr><td><strong>Package:</strong></td><td>${pkg.label}</td></tr>
              <tr><td><strong>Cost paid:</strong></td><td>₦${pkg.costNaira.toLocaleString()}</td></tr>
              <tr><td><strong>Credit to add:</strong></td><td>₦${pkg.creditNaira.toLocaleString()}</td></tr>
              <tr><td><strong>Current balance:</strong></td><td>₦${franchise.creditBalance.toLocaleString()}</td></tr>
              <tr><td><strong>Transaction ID:</strong></td><td>${transactionId}</td></tr>
            </table>
            <p><a href="${req.file.path}">View Payment Proof</a></p>
          `,
        });
      }
    } catch (e) {
      console.error('Admin email failed:', e.message);
    }

    res.json({
      success: true,
      message: 'Credit top-up submitted. Awaiting admin approval.',
      data: {
        transactionId,
        packageLabel: pkg.label,
        costNaira:    pkg.costNaira,
        creditToAdd:  pkg.creditNaira,
        status:       'pending',
      },
    });
  } catch (err) {
    console.error('buyCredit error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════
// FRANCHISE VENDOR — SALES MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /franchise/my-sales
 * Franchise sees all buyer transactions through them
 */
exports.getMySales = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id });
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    const { status, page = 1, limit = 20 } = req.query;
    const query = { franchise: franchise._id };
    if (status) query.status = status;

    const transactions = await FranchiseTx.find(query)
      .populate('buyer', 'name email phone username')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await FranchiseTx.countDocuments(query);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(total / parseInt(limit)),
        totalCount:  total,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /franchise/self-purchase
 * Franchise buys shares for THEMSELVES using their own credit balance.
 * No payment proof needed — just deducted from credit.
 */
exports.selfPurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tierKey, currency = 'naira' } = req.body;

    const franchise = await Franchise.findOne({ user: userId, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const tierData = await getTierData(tierKey);
    if (!tierData) return res.status(400).json({ success: false, message: 'Invalid or inactive tier' });

    const companyPrice = currency === 'naira' ? tierData.priceNGN : tierData.priceUSD;
    if (!companyPrice) return res.status(400).json({ success: false, message: `Tier not available in ${currency}` });

    const transactionId = genTxId('FSP');

    // ── Atomic deduction: guard and update in one operation ──────
    const updatedFranchise = await Franchise.findOneAndUpdate(
      {
        _id:           franchise._id,
        status:        'active',
        creditBalance: { $gte: companyPrice },
      },
      {
        $inc: {
          creditBalance:   -companyPrice,
          totalCreditUsed:  companyPrice,
          totalSales:       1,
        },
      },
      { new: true }
    );

    if (!updatedFranchise) {
      return res.status(400).json({
        success: false,
        message: `Insufficient credit balance. You have ₦${franchise.creditBalance.toLocaleString()} but need ₦${companyPrice.toLocaleString()}`,
        creditBalance: franchise.creditBalance,
        required:      companyPrice,
      });
    }

    await FranchiseTx.create({
      transactionId,
      franchise:        updatedFranchise._id,
      franchiseUser:    updatedFranchise.user,
      buyer:            userId,
      isSelfPurchase:   true,
      tierKey,
      packageLabel:     tierData.name,
      ownershipPct:     tierData.percentPerShare,
      earningKobo:      tierData.earningPerPhone,
      companyPrice,
      currency,
      paymentMethod:    'franchise_credit',
      status:           'approved',
      approvedAt:       new Date(),
      sharesReleased:   true,
      sharesReleasedAt: new Date(),
    });

    await releaseShares({
      userId,
      tierKey,
      tierData,
      companyPrice,
      currency,
      transactionId,
      source: 'franchise_self',
    });

    res.json({
      success: true,
      message: 'Shares purchased and added to your portfolio.',
      data: {
        transactionId,
        tierKey,
        packageLabel:    tierData.name,
        companyPrice,
        currency,
        ownershipPct:    tierData.percentPerShare,
        creditRemaining: updatedFranchise.creditBalance,  // ← true post-deduction balance
      },
    });
  } catch (err) {
    console.error('selfPurchase error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/approve/:transactionId
 * Franchise approves a buyer's payment → shares released, credit deducted
 */
exports.approveTransaction = async (req, res) => {
  try {
    const userId    = req.user.id;
    const franchise = await Franchise.findOne({ user: userId, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const tx = await FranchiseTx.findOne({
      transactionId: req.params.transactionId,
      franchise:     franchise._id,
    });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot approve a transaction that is ${tx.status}` });
    }

    const tierData = await getTierData(tx.tierKey);
    if (!tierData) return res.status(400).json({ success: false, message: 'Tier no longer available' });

    // ── Atomic deduction: the $gte condition and $inc happen in one operation.
    // If two approvals fire at the same time, only the one that finds
    // creditBalance >= companyPrice will succeed — the other gets null back.
    const updatedFranchise = await Franchise.findOneAndUpdate(
      {
        _id:           franchise._id,
        status:        'active',
        creditBalance: { $gte: tx.companyPrice },
      },
      {
        $inc: {
          creditBalance:   -tx.companyPrice,
          totalCreditUsed:  tx.companyPrice,
          totalSales:       1,
        },
      },
      { new: true }
    );

    if (!updatedFranchise) {
      return res.status(400).json({
        success: false,
        message: `Insufficient credit. You have ₦${franchise.creditBalance.toLocaleString()} but this transaction requires ₦${tx.companyPrice.toLocaleString()}. Another approval may have just reduced your balance.`,
      });
    }

    tx.status           = 'approved';
    tx.approvedAt       = new Date();
    tx.sharesReleased   = true;
    tx.sharesReleasedAt = new Date();
    tx.ownershipPct     = tierData.percentPerShare;
    tx.earningKobo      = tierData.earningPerPhone;
    await tx.save();

    await releaseShares({
      userId:        tx.buyer,
      tierKey:       tx.tierKey,
      tierData,
      companyPrice:  tx.companyPrice,
      currency:      tx.currency,
      transactionId: tx.transactionId,
      source:        'franchise_sale',
    });

    const buyer = await User.findById(tx.buyer);
    if (buyer?.email) {
      try {
        await sendEmail({
          email:   buyer.email,
          subject: 'Payment Approved — Shares Released!',
          html: `
            <h2>Your shares have been released! 🎉</h2>
            <p>Dear ${buyer.name},</p>
            <p>${updatedFranchise.businessName} has approved your payment.</p>
            <p><strong>Package:</strong> ${tx.packageLabel || tx.tierKey}</p>
            <p><strong>Amount paid:</strong> ₦${tx.companyPrice.toLocaleString()}</p>
            <p><strong>Transaction ID:</strong> ${tx.transactionId}</p>
            <p>Your shares are now in your portfolio.</p>
          `,
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    res.json({
      success: true,
      message: 'Payment approved. Shares released to buyer.',
      data: {
        transactionId:   tx.transactionId,
        buyer:           buyer?.name,
        tierKey:         tx.tierKey,
        companyPrice:    tx.companyPrice,
        creditRemaining: updatedFranchise.creditBalance,  // ← reflects true post-deduction balance
      },
    });
  } catch (err) {
    console.error('approveTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/reject/:transactionId
 * Franchise rejects a buyer's payment
 */
exports.rejectTransaction = async (req, res) => {
  try {
    const userId    = req.user.id;
    const franchise = await Franchise.findOne({ user: userId, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const tx = await FranchiseTx.findOne({
      transactionId: req.params.transactionId,
      franchise:     franchise._id,
    });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot reject a transaction that is ${tx.status}` });
    }

    tx.status          = 'rejected';
    tx.rejectionReason = req.body.reason || 'Payment not confirmed';
    await tx.save();

    const buyer = await User.findById(tx.buyer);
    if (buyer?.email) {
      try {
        await sendEmail({
          email: buyer.email,
          subject: 'Payment Not Confirmed',
          html: `
            <h2>Payment Not Confirmed</h2>
            <p>Dear ${buyer.name},</p>
            <p>${franchise.businessName} could not confirm your payment for <strong>${tx.packageLabel || tx.tierKey}</strong>.</p>
            <p><strong>Reason:</strong> ${tx.rejectionReason}</p>
            <p>Please contact the vendor or raise a dispute if you believe this is an error.</p>
          `,
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    res.json({ success: true, message: 'Transaction rejected', data: { transactionId: tx.transactionId, status: tx.status } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════
// BUYER — PURCHASE THROUGH FRANCHISE
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /franchise/:franchiseId/buy
 */
exports.buyFromFranchise = async (req, res) => {
  try {
    const buyerId  = req.user.id;
    const { tierKey, currency = 'naira', buyerNote } = req.body;

    const franchise = await Franchise.findById(req.params.franchiseId);
    if (!franchise || franchise.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Franchise not found or inactive' });
    }

    if (franchise.user.toString() === buyerId) {
      return res.status(400).json({
        success: false,
        message: 'You own this franchise. Use POST /franchise/self-purchase to buy for yourself.',
      });
    }

    const tierData = await getTierData(tierKey);
    if (!tierData) return res.status(400).json({ success: false, message: 'Invalid or inactive tier' });

    const companyPrice = currency === 'naira' ? tierData.priceNGN : tierData.priceUSD;
    if (!companyPrice) return res.status(400).json({ success: false, message: `Tier not available in ${currency}` });

    if (franchise.creditBalance < companyPrice) {
      return res.status(400).json({
        success: false,
        message: 'This franchise does not currently have enough credit for this package. Please contact them or choose another franchise.',
      });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Payment proof is required' });
    }

    const pending = await FranchiseTx.findOne({
      buyer:     buyerId,
      franchise: franchise._id,
      status:    'pending',
    });
    if (pending) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending purchase with this franchise. Wait for the vendor to approve or reject it.',
        transactionId: pending.transactionId,
      });
    }

    const transactionId = genTxId('FRT');

    const tx = await FranchiseTx.create({
      transactionId,
      franchise:     franchise._id,
      franchiseUser: franchise.user,
      buyer:         buyerId,
      isSelfPurchase: false,
      tierKey,
      packageLabel:  tierData.name,
      ownershipPct:  tierData.percentPerShare,
      earningKobo:   tierData.earningPerPhone,
      companyPrice,
      currency,
      paymentMethod: 'bank_transfer',
      paymentProofPath:            req.file.path,
      paymentProofCloudinaryUrl:   req.file.path,
      paymentProofCloudinaryId:    req.file.filename,
      paymentProofOriginalName:    req.file.originalname,
      paymentProofFileSize:        req.file.size,
      buyerNote,
      status: 'pending',
    });

    const franchiseOwner = await User.findById(franchise.user);
    if (franchiseOwner?.email) {
      try {
        const buyer = await User.findById(buyerId);
        await sendEmail({
          email: franchiseOwner.email,
          subject: 'New Purchase — Action Required',
          html: `
            <h2>New Purchase Requires Your Approval</h2>
            <p><strong>Buyer:</strong> ${buyer?.name} (${buyer?.email})</p>
            <p><strong>Package:</strong> ${tierData.name}</p>
            <p><strong>Amount:</strong> ₦${companyPrice.toLocaleString()}</p>
            <p><strong>Transaction ID:</strong> ${transactionId}</p>
            ${buyerNote ? `<p><strong>Buyer note:</strong> ${buyerNote}</p>` : ''}
            <p>Log in to your franchise dashboard to approve or reject this payment.</p>
          `,
        });
      } catch (e) { console.error('Email error:', e.message); }
    }

    res.status(201).json({
      success: true,
      message: 'Purchase submitted. The vendor will review your payment proof and approve shares.',
      data: {
        transactionId,
        tierKey,
        packageLabel: tierData.name,
        companyPrice,
        currency,
        franchiseName: franchise.businessName,
        bankDetails:   franchise.bankDetails,
        status:        'pending',
      },
    });
  } catch (err) {
    console.error('buyFromFranchise error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /franchise/my-purchases
 */
exports.getMyPurchases = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const transactions = await FranchiseTx.find({ buyer: req.user.id })
      .populate('franchise', 'businessName')
      .populate('franchiseUser', 'name username email')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await FranchiseTx.countDocuments({ buyer: req.user.id });

    res.json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(total / parseInt(limit)),
        totalCount:  total,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /franchise/dispute/:transactionId
 */
exports.raiseDispute = async (req, res) => {
  try {
    const tx = await FranchiseTx.findOne({ transactionId: req.params.transactionId, buyer: req.user.id });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (!['pending', 'rejected'].includes(tx.status)) {
      return res.status(400).json({ success: false, message: `Cannot dispute a ${tx.status} transaction` });
    }

    tx.status  = 'disputed';
    tx.dispute = {
      raisedBy: req.user.id,
      raisedAt: new Date(),
      reason:   req.body.reason || 'Payment made but shares not released',
    };
    await tx.save();

    await Franchise.findByIdAndUpdate(tx.franchise, { $inc: { disputeCount: 1 } });

    res.json({ success: true, message: 'Dispute raised. An admin will review it.', data: tx });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /franchise/proof/:transactionId
 */
exports.getPaymentProof = async (req, res) => {
  try {
    const userId = req.user.id;
    const tx = await FranchiseTx.findOne({ transactionId: req.params.transactionId });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });

    const user    = await User.findById(userId);
    const isAdmin = user?.isAdmin;
    const isBuyer = tx.buyer.toString() === userId;
    const franchiseOwner = await Franchise.findById(tx.franchise);
    const isVendor = franchiseOwner?.user?.toString() === userId;

    if (!isAdmin && !isBuyer && !isVendor) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!tx.paymentProofCloudinaryUrl) {
      return res.status(404).json({ success: false, message: 'No payment proof on file' });
    }

    if (req.query.redirect === 'true') {
      return res.redirect(tx.paymentProofCloudinaryUrl);
    }

    res.json({
      success: true,
      cloudinaryUrl: tx.paymentProofCloudinaryUrl,
      originalName:  tx.paymentProofOriginalName,
      fileSize:      tx.paymentProofFileSize,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════

/** GET /franchise/admin/list */
exports.adminListFranchises = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};

    const franchises = await Franchise.find(query)
      .populate('user', 'name email phone username')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await Franchise.countDocuments(query);

    res.json({
      success: true,
      data: franchises,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(total / parseInt(limit)),
        totalCount:  total,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /franchise/admin/stats */
exports.adminStats = async (req, res) => {
  try {
    const [total, active, suspended, totalTx, disputedTx] = await Promise.all([
      Franchise.countDocuments(),
      Franchise.countDocuments({ status: 'active' }),
      Franchise.countDocuments({ status: 'suspended' }),
      FranchiseTx.countDocuments(),
      FranchiseTx.countDocuments({ status: 'disputed' }),
    ]);

    const creditStats = await Franchise.aggregate([
      { $group: {
        _id: null,
        totalCreditIssued:  { $sum: '$totalCreditPurchased' },
        totalCreditUsed:    { $sum: '$totalCreditUsed' },
        totalCreditBalance: { $sum: '$creditBalance' },
      }},
    ]);

    const revenueStats = await Franchise.aggregate([
      { $unwind: '$creditPurchases' },
      { $match: { 'creditPurchases.status': 'approved' } },
      { $group: {
        _id:            null,
        totalRevenue:   { $sum: '$creditPurchases.costNaira' },
        totalApproved:  { $sum: 1 },
      }},
    ]);

    res.json({
      success: true,
      data: {
        franchises: { total, active, suspended },
        transactions: { total: totalTx, disputed: disputedTx },
        credit: creditStats[0] || { totalCreditIssued: 0, totalCreditUsed: 0, totalCreditBalance: 0 },
        revenue: revenueStats[0] || { totalRevenue: 0, totalApproved: 0 },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /franchise/admin/transactions */
exports.adminGetTransactions = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, franchiseId } = req.query;
    const query = {};
    if (status)      query.status    = status;
    if (franchiseId) query.franchise = franchiseId;

    const transactions = await FranchiseTx.find(query)
      .populate('buyer',         'name email phone username')
      .populate('franchiseUser', 'name email username')
      .populate('franchise',     'businessName')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await FranchiseTx.countDocuments(query);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages:  Math.ceil(total / parseInt(limit)),
        totalCount:  total,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/admin/:franchiseId/status
 * Suspend or revoke a franchise (admin no longer needs to approve new ones)
 */
exports.adminUpdateStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!['active', 'suspended', 'revoked'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be active | suspended | revoked' });
    }

    const franchise = await Franchise.findById(req.params.franchiseId);
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    franchise.status = status;
    await franchise.save();

    const owner = await User.findById(franchise.user);
    if (owner?.email) {
      try {
        await sendEmail({
          email: owner.email,
          subject: `Franchise ${status === 'active' ? 'Reinstated' : status === 'suspended' ? 'Suspended' : 'Revoked'}`,
          html: `
            <h2>Franchise Status Update</h2>
            <p>Dear ${owner.name},</p>
            <p>Your franchise "<strong>${franchise.businessName}</strong>" has been <strong>${status}</strong>.</p>
            ${reason ? `<p>Reason: ${reason}</p>` : ''}
          `,
        });
      } catch (e) {}
    }

    res.json({ success: true, message: `Franchise ${status}`, data: franchise });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/admin/credit/:franchiseId/approve/:transactionId
 * Admin approves a franchise credit purchase → adds credit to balance
 */
exports.adminApproveCredit = async (req, res) => {
  try {
    const { franchiseId, transactionId } = req.params;
    const { adminNote } = req.body;

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    const purchase = franchise.creditPurchases.find(p => p.transactionId === transactionId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Credit purchase not found' });
    if (purchase.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Already ${purchase.status}` });
    }

    purchase.status     = 'approved';
    purchase.approvedBy = req.user.id;
    purchase.approvedAt = new Date();
    purchase.adminNote  = adminNote;

    franchise.creditBalance        += purchase.creditNaira;
    franchise.totalCreditPurchased += purchase.creditNaira;
    await franchise.save();

    const owner = await User.findById(franchise.user);
    if (owner?.email) {
      try {
        await sendEmail({
          email: owner.email,
          subject: 'Franchise Credit Approved — You Can Now Sell!',
          html: `
            <h2>Credit Balance Updated 🎉</h2>
            <p>Dear ${owner.name},</p>
            <p>Your payment for the <strong>${purchase.packageLabel}</strong> package has been approved.</p>
            <p><strong>Credit added:</strong> ₦${purchase.creditNaira.toLocaleString()}</p>
            <p><strong>New balance:</strong> ₦${franchise.creditBalance.toLocaleString()}</p>
            <p>You can now approve purchases from buyers up to this credit limit.</p>
          `,
        });
      } catch (e) {}
    }

    res.json({
      success: true,
      message: 'Credit approved and added to franchise balance',
      data: {
        transactionId,
        creditAdded:    purchase.creditNaira,
        newBalance:     franchise.creditBalance,
        packageLabel:   purchase.packageLabel,
      },
    });
  } catch (err) {
    console.error('adminApproveCredit error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/admin/credit/:franchiseId/reject/:transactionId
 */
exports.adminRejectCredit = async (req, res) => {
  try {
    const { franchiseId, transactionId } = req.params;
    const { adminNote } = req.body;

    const franchise = await Franchise.findById(franchiseId);
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    const purchase = franchise.creditPurchases.find(p => p.transactionId === transactionId);
    if (!purchase) return res.status(404).json({ success: false, message: 'Credit purchase not found' });
    if (purchase.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Already ${purchase.status}` });
    }

    purchase.status    = 'rejected';
    purchase.adminNote = adminNote;
    await franchise.save();

    const owner = await User.findById(franchise.user);
    if (owner?.email) {
      try {
        await sendEmail({
          email: owner.email,
          subject: 'Franchise Credit Purchase Rejected',
          html: `
            <h2>Credit Purchase Not Approved</h2>
            <p>Dear ${owner.name},</p>
            <p>Your credit purchase for the <strong>${purchase.packageLabel}</strong> package was not approved.</p>
            ${adminNote ? `<p>Reason: ${adminNote}</p>` : ''}
            <p>Please contact support or resubmit with a clearer payment proof.</p>
          `,
        });
      } catch (e) {}
    }

    res.json({ success: true, message: 'Credit purchase rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /franchise/admin/credit/pending
 */
exports.adminGetPendingCredits = async (req, res) => {
  try {
    const franchises = await Franchise.find({ 'creditPurchases.status': 'pending' })
      .populate('user', 'name email phone username')
      .lean();

    const pending = [];
    for (const f of franchises) {
      for (const p of f.creditPurchases) {
        if (p.status === 'pending') {
          pending.push({
            franchiseId:      f._id,
            franchiseName:    f.businessName,
            franchiseStatus:  f.status,
            owner: {
              id:    f.user._id,
              name:  f.user.name,
              email: f.user.email,
            },
            creditBalance:   f.creditBalance,
            purchase:        p,
          });
        }
      }
    }

    pending.sort((a, b) => new Date(b.purchase.createdAt) - new Date(a.purchase.createdAt));

    res.json({ success: true, data: pending, total: pending.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /franchise/admin/resolve-dispute/:transactionId
 */
exports.adminResolveDispute = async (req, res) => {
  try {
    const { favorBuyer, resolution, adminNotes } = req.body;
    const tx = await FranchiseTx.findOne({ transactionId: req.params.transactionId });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status !== 'disputed') {
      return res.status(400).json({ success: false, message: 'Transaction is not in disputed status' });
    }

    tx.dispute.resolvedBy = req.user.id;
    tx.dispute.resolvedAt = new Date();
    tx.dispute.resolution = resolution;
    tx.dispute.adminNotes = adminNotes;

    if (favorBuyer) {
      tx.status = 'resolved_buyer';

      const tierData = await getTierData(tx.tierKey);
      if (tierData) {
        // ── Attempt atomic deduction first ───────────────────────
        const updatedFranchise = await Franchise.findOneAndUpdate(
          {
            _id:           tx.franchise,
            creditBalance: { $gte: tx.companyPrice },
          },
          {
            $inc: {
              creditBalance:   -tx.companyPrice,
              totalCreditUsed:  tx.companyPrice,
            },
          },
          { new: true }
        );

        // ── If credit was insufficient, zero-floor the balance ───
        // Shares are still released — this is an admin decision, not
        // a voluntary approval, so the franchise bears the shortfall.
        if (!updatedFranchise) {
          await Franchise.findByIdAndUpdate(tx.franchise, {
            $set: { creditBalance: 0 },
          });
          console.warn(
            `Dispute ${tx.transactionId}: franchise ${tx.franchise} had insufficient credit. ` +
            `Balance zeroed. Shares still released per admin decision.`
          );
        }

        await releaseShares({
          userId:        tx.buyer,
          tierKey:       tx.tierKey,
          tierData,
          companyPrice:  tx.companyPrice,
          currency:      tx.currency,
          transactionId: `${tx.transactionId}-DISPUTE`,
          source:        'dispute_resolution',
        });

        tx.sharesReleased   = true;
        tx.sharesReleasedAt = new Date();
      }
    } else {
      tx.status = 'resolved_vendor';
    }

    await tx.save();

    res.json({
      success: true,
      message: `Dispute resolved in favour of ${favorBuyer ? 'buyer' : 'vendor'}`,
      data: tx,
    });
  } catch (err) {
    console.error('adminResolveDispute error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /franchise/admin/adjust-credit/:franchiseId
 */
exports.adminAdjustCredit = async (req, res) => {
  try {
    const { amount, type, reason } = req.body;
    if (!amount || !['add', 'deduct'].includes(type)) {
      return res.status(400).json({ success: false, message: 'amount and type (add|deduct) are required' });
    }

    const franchise = await Franchise.findById(req.params.franchiseId);
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    const adjustAmount = parseFloat(amount);
    if (type === 'add') {
      franchise.creditBalance        += adjustAmount;
      franchise.totalCreditPurchased += adjustAmount;
    } else {
      if (franchise.creditBalance < adjustAmount) {
        return res.status(400).json({ success: false, message: 'Deduction exceeds current balance' });
      }
      franchise.creditBalance -= adjustAmount;
    }

    await franchise.save();

    const owner = await User.findById(franchise.user);
    if (owner?.email) {
      try {
        await sendEmail({
          email: owner.email,
          subject: `Franchise Credit ${type === 'add' ? 'Added' : 'Adjusted'}`,
          html: `
            <h2>Credit Balance Updated</h2>
            <p>An admin has ${type === 'add' ? 'added' : 'deducted'} ₦${adjustAmount.toLocaleString()} 
            ${type === 'add' ? 'to' : 'from'} your franchise credit balance.</p>
            ${reason ? `<p>Reason: ${reason}</p>` : ''}
            <p>New balance: ₦${franchise.creditBalance.toLocaleString()}</p>
          `,
        });
      } catch (e) {}
    }

    res.json({
      success: true,
      message: `Credit ${type === 'add' ? 'added' : 'deducted'} successfully`,
      data: {
        type,
        amount:     adjustAmount,
        newBalance: franchise.creditBalance,
        reason,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};