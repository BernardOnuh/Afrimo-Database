const Franchise = require('../models/Franchise');
const FranchiseTransaction = require('../models/FranchiseTransaction');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const Share = require('../models/Share');
const crypto = require('crypto');
const { sendEmail } = require('../utils/emailService');

const generateTxId = () => `FRN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString().slice(-6)}`;

// ==================== USER-FACING ====================

/**
 * @desc    Apply to become a franchise
 * @route   POST /api/franchise/apply
 */
exports.applyForFranchise = async (req, res) => {
  try {
    const userId = req.user.id;
    const { businessName, businessDescription, bankName, accountNumber, accountName } = req.body;

    // Check if user already has shares
    const userShare = await UserShare.findOne({ user: userId });
    if (!userShare || (userShare.totalShares === 0 && userShare.coFounderShares === 0)) {
      return res.status(400).json({ success: false, message: 'You must own shares to become a franchise vendor.' });
    }

    // Check if already applied
    const existing = await Franchise.findOne({ user: userId });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have a franchise application.', status: existing.status });
    }

    if (!businessName || !bankName || !accountNumber || !accountName) {
      return res.status(400).json({ success: false, message: 'Business name and bank details are required.' });
    }

    const franchise = await Franchise.create({
      user: userId,
      businessName,
      businessDescription,
      bankDetails: { bankName, accountNumber, accountName },
      status: 'pending',
    });

    res.status(201).json({ success: true, message: 'Franchise application submitted. Awaiting admin approval.', data: franchise });
  } catch (error) {
    console.error('Franchise apply error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit application' });
  }
};

/**
 * @desc    Get my franchise profile
 * @route   GET /api/franchise/my-profile
 */
exports.getMyFranchise = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id });
    if (!franchise) {
      return res.status(404).json({ success: false, message: 'No franchise found', isFranchise: false });
    }
    res.json({ success: true, data: franchise, isFranchise: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch franchise profile' });
  }
};

/**
 * @desc    Update franchise bank details
 * @route   PUT /api/franchise/bank-details
 */
exports.updateBankDetails = async (req, res) => {
  try {
    const { bankName, accountNumber, accountName } = req.body;
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(404).json({ success: false, message: 'Active franchise not found' });

    franchise.bankDetails = { bankName, accountNumber, accountName };
    await franchise.save();
    res.json({ success: true, message: 'Bank details updated', data: franchise.bankDetails });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update bank details' });
  }
};

/**
 * @desc    Buy shares in bulk (franchise purchases from company at discount)
 * @route   POST /api/franchise/buy-bulk
 */
exports.buyBulk = async (req, res) => {
  try {
    const { tier, quantity, paymentMethod, bankName, accountName, reference } = req.body;
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const tiers = Share.getTierConfig();
    const tierConfig = tiers[tier];
    if (!tierConfig) return res.status(400).json({ success: false, message: 'Invalid tier' });

    const originalPrice = tierConfig.priceNGN * quantity;
    if (originalPrice < Franchise.MIN_BULK_AMOUNT) {
      return res.status(400).json({ success: false, message: `Minimum bulk purchase is ₦${Franchise.MIN_BULK_AMOUNT.toLocaleString()}` });
    }

    const discountedPrice = Math.round(originalPrice * (1 - Franchise.DISCOUNT_PERCENT / 100));
    const transactionId = generateTxId();

    // Handle payment proof upload
    let paymentProof = null;
    let paymentProofCloudinaryId = null;
    if (req.file) {
      paymentProof = req.file.path || req.file.secure_url || req.file.url;
      paymentProofCloudinaryId = req.file.filename || req.file.public_id;
    }

    franchise.bulkPurchases.push({
      transactionId,
      tier,
      quantity,
      originalPrice,
      discountedPrice,
      discountPercent: Franchise.DISCOUNT_PERCENT,
      paymentMethod: paymentMethod || 'manual_bank_transfer',
      paymentProof,
      paymentProofCloudinaryId,
      status: 'pending',
    });

    await franchise.save();

    res.status(201).json({
      success: true,
      message: 'Bulk purchase submitted. Awaiting admin approval.',
      data: {
        transactionId,
        tier,
        quantity,
        originalPrice,
        discountedPrice,
        discount: `${Franchise.DISCOUNT_PERCENT}%`,
      }
    });
  } catch (error) {
    console.error('Franchise buy-bulk error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit bulk purchase' });
  }
};

/**
 * @desc    Create a custom resale package
 * @route   POST /api/franchise/packages
 */
exports.createPackage = async (req, res) => {
  try {
    const { name, description, priceNGN, priceUSD, sharesIncluded, tier } = req.body;
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    if (!name || !priceNGN || !tier) {
      return res.status(400).json({ success: false, message: 'Name, price, and tier are required' });
    }

    // Check inventory
    const tierInv = franchise.inventory.tierInventory.get(tier);
    if (!tierInv || tierInv.available < (sharesIncluded || 1)) {
      return res.status(400).json({ success: false, message: 'Insufficient inventory for this tier' });
    }

    franchise.packages.push({ name, description, priceNGN, priceUSD, sharesIncluded: sharesIncluded || 1, tier });
    await franchise.save();

    res.status(201).json({ success: true, message: 'Package created', data: franchise.packages[franchise.packages.length - 1] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create package' });
  }
};

/**
 * @desc    Update a package
 * @route   PUT /api/franchise/packages/:packageId
 */
exports.updatePackage = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const pkg = franchise.packages.id(req.params.packageId);
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    const { name, description, priceNGN, priceUSD, sharesIncluded, isActive } = req.body;
    if (name) pkg.name = name;
    if (description !== undefined) pkg.description = description;
    if (priceNGN) pkg.priceNGN = priceNGN;
    if (priceUSD !== undefined) pkg.priceUSD = priceUSD;
    if (sharesIncluded) pkg.sharesIncluded = sharesIncluded;
    if (isActive !== undefined) pkg.isActive = isActive;

    await franchise.save();
    res.json({ success: true, message: 'Package updated', data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update package' });
  }
};

/**
 * @desc    Delete a package
 * @route   DELETE /api/franchise/packages/:packageId
 */
exports.deletePackage = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    franchise.packages = franchise.packages.filter(p => p._id.toString() !== req.params.packageId);
    await franchise.save();
    res.json({ success: true, message: 'Package deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete package' });
  }
};

/**
 * @desc    Get franchise's sales/transactions
 * @route   GET /api/franchise/my-sales
 */
exports.getMySales = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id });
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    const transactions = await FranchiseTransaction.find({ franchise: franchise._id })
      .populate('buyer', 'name email phone userName')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch sales' });
  }
};

/**
 * @desc    Vendor validates a buyer's payment (releases shares)
 * @route   PUT /api/franchise/validate/:transactionId
 */
exports.validatePayment = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const tx = await FranchiseTransaction.findOne({ transactionId: req.params.transactionId, franchise: franchise._id });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ success: false, message: `Cannot validate transaction in ${tx.status} status` });

    // Release shares to buyer
    const tiers = Share.getTierConfig();
    const tierConfig = tiers[tx.tier];
    if (!tierConfig) return res.status(400).json({ success: false, message: 'Invalid tier configuration' });

    // Deduct from franchise inventory
    const tierInv = franchise.inventory.tierInventory.get(tx.tier);
    if (!tierInv || tierInv.available < tx.quantity) {
      return res.status(400).json({ success: false, message: 'Insufficient inventory to release shares' });
    }

    tierInv.sold += tx.quantity;
    tierInv.available -= tx.quantity;
    franchise.inventory.totalSharesSold += tx.quantity;
    franchise.inventory.availableShares -= tx.quantity;
    franchise.totalRevenue += tx.amount;
    franchise.totalSales += 1;

    // Add shares to buyer's UserShare
    let userShare = await UserShare.findOne({ user: tx.buyer });
    if (!userShare) {
      userShare = new UserShare({ user: tx.buyer, transactions: [], totalShares: 0, coFounderShares: 0 });
    }

    const sharesCount = tx.quantity * (tierConfig.sharesIncluded || 1);
    const isCofounder = tierConfig.type === 'cofounder';

    userShare.transactions.push({
      transactionId: tx.transactionId,
      type: isCofounder ? 'co-founder' : 'share',
      shares: isCofounder ? 0 : sharesCount,
      coFounderShares: isCofounder ? sharesCount : 0,
      totalAmount: tx.amount,
      currency: tx.currency,
      paymentMethod: 'franchise',
      status: 'completed',
      date: new Date(),
      tier: tx.tier,
    });

    if (isCofounder) {
      userShare.coFounderShares += sharesCount;
    } else {
      userShare.totalShares += sharesCount;
    }

    // Update global share config
    const shareConfig = await Share.getCurrentConfig();
    shareConfig.sharesSold += sharesCount;
    const tierSalesKey = `${tx.tier}Sold`;
    shareConfig.tierSales[tierSalesKey] = (shareConfig.tierSales[tierSalesKey] || 0) + sharesCount;

    // Update tx status
    tx.status = 'validated';
    tx.validatedAt = new Date();
    tx.validatedBy = req.user.id;
    tx.sharesReleased = true;
    tx.sharesReleasedAt = new Date();

    await Promise.all([franchise.save(), userShare.save(), shareConfig.save(), tx.save()]);

    // Notify buyer
    const buyer = await User.findById(tx.buyer);
    if (buyer?.email) {
      try {
        await sendEmail({
          email: buyer.email,
          subject: 'AfriMobile - Shares Released!',
          html: `<h2>Your shares have been released!</h2>
            <p>Your payment for ${tx.quantity}× ${tx.tier} shares has been validated by ${franchise.businessName}.</p>
            <p>Transaction ID: ${tx.transactionId}</p>
            <p>The shares are now in your portfolio.</p>`
        });
      } catch (e) { console.error('Email error:', e); }
    }

    res.json({ success: true, message: 'Payment validated. Shares released to buyer.', data: tx });
  } catch (error) {
    console.error('Franchise validate error:', error);
    res.status(500).json({ success: false, message: 'Failed to validate payment' });
  }
};

/**
 * @desc    Vendor rejects a buyer's payment
 * @route   PUT /api/franchise/reject/:transactionId
 */
exports.rejectPayment = async (req, res) => {
  try {
    const franchise = await Franchise.findOne({ user: req.user.id, status: 'active' });
    if (!franchise) return res.status(403).json({ success: false, message: 'Active franchise required' });

    const tx = await FranchiseTransaction.findOne({ transactionId: req.params.transactionId, franchise: franchise._id });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ success: false, message: `Cannot reject transaction in ${tx.status} status` });

    tx.status = 'rejected';
    tx.rejectionReason = req.body.reason || 'Payment not received or invalid';
    await tx.save();

    res.json({ success: true, message: 'Payment rejected', data: tx });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reject payment' });
  }
};

// ==================== BUYER-FACING ====================

/**
 * @desc    List active franchises (for buyers to choose from)
 * @route   GET /api/franchise/list
 */
exports.listFranchises = async (req, res) => {
  try {
    const userId = req.user?.id;
    let referrerFranchise = null;

    // Check if user's referrer is a franchise — prioritize them
    if (userId) {
      const user = await User.findById(userId);
      if (user?.referralInfo?.source && user.referralInfo.source !== 'direct') {
        const referrer = await User.findOne({ 'referralInfo.code': user.referralInfo.source });
        if (referrer) {
          referrerFranchise = await Franchise.findOne({ user: referrer._id, status: 'active' })
            .populate('user', 'name userName email')
            .lean();
        }
      }
    }

    const franchises = await Franchise.find({ status: 'active' })
      .populate('user', 'name userName email')
      .select('businessName businessDescription packages inventory.availableShares totalSales user')
      .lean();

    // Mark referrer franchise
    const result = franchises.map(f => ({
      ...f,
      isReferrerFranchise: referrerFranchise && f._id.toString() === referrerFranchise._id.toString(),
    }));

    // Sort: referrer's franchise first
    result.sort((a, b) => (b.isReferrerFranchise ? 1 : 0) - (a.isReferrerFranchise ? 1 : 0));

    res.json({ success: true, data: result, referrerFranchiseId: referrerFranchise?._id || null });
  } catch (error) {
    console.error('List franchises error:', error);
    res.status(500).json({ success: false, message: 'Failed to list franchises' });
  }
};

/**
 * @desc    Get franchise detail + packages (for buyer)
 * @route   GET /api/franchise/:franchiseId/detail
 */
exports.getFranchiseDetail = async (req, res) => {
  try {
    const franchise = await Franchise.findById(req.params.franchiseId)
      .populate('user', 'name userName email')
      .lean();
    if (!franchise || franchise.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Franchise not found or not active' });
    }

    res.json({
      success: true,
      data: {
        _id: franchise._id,
        businessName: franchise.businessName,
        businessDescription: franchise.businessDescription,
        bankDetails: franchise.bankDetails,
        packages: franchise.packages.filter(p => p.isActive),
        availableShares: franchise.inventory.availableShares,
        totalSales: franchise.totalSales,
        vendor: franchise.user,
        isReferrerFranchise: false, // caller can check
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch franchise detail' });
  }
};

/**
 * @desc    Buy from franchise (submit payment proof)
 * @route   POST /api/franchise/:franchiseId/buy
 */
exports.buyFromFranchise = async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { tier, quantity, bankName, accountName, reference, packageId } = req.body;

    const franchise = await Franchise.findById(req.params.franchiseId);
    if (!franchise || franchise.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Franchise not active' });
    }

    // Determine what's being bought
    let amount, actualTier, actualQuantity;

    if (packageId) {
      // Buying a custom package
      const pkg = franchise.packages.id(packageId);
      if (!pkg || !pkg.isActive) return res.status(404).json({ success: false, message: 'Package not found' });
      amount = pkg.priceNGN * (quantity || 1);
      actualTier = pkg.tier;
      actualQuantity = pkg.sharesIncluded * (quantity || 1);
    } else {
      // Buying by tier directly
      const tiers = Share.getTierConfig();
      const tierConfig = tiers[tier];
      if (!tierConfig) return res.status(400).json({ success: false, message: 'Invalid tier' });
      actualQuantity = quantity || 1;
      actualTier = tier;
      // Franchise sets their own price, but we need it from the request
      amount = req.body.amount;
      if (!amount) return res.status(400).json({ success: false, message: 'Amount is required' });
    }

    // Check franchise inventory
    const tierInv = franchise.inventory.tierInventory.get(actualTier);
    if (!tierInv || tierInv.available < actualQuantity) {
      return res.status(400).json({ success: false, message: 'Franchise does not have enough inventory for this purchase' });
    }

    // Check for pending franchise transaction
    const pendingTx = await FranchiseTransaction.findOne({ buyer: buyerId, franchise: franchise._id, status: 'pending' });
    if (pendingTx) {
      return res.status(400).json({ success: false, message: 'You already have a pending purchase with this franchise. Wait for validation.' });
    }

    let paymentProof = null;
    let paymentProofCloudinaryId = null;
    if (req.file) {
      paymentProof = req.file.path || req.file.secure_url || req.file.url;
      paymentProofCloudinaryId = req.file.filename || req.file.public_id;
    }

    const tx = await FranchiseTransaction.create({
      transactionId: generateTxId(),
      franchise: franchise._id,
      franchiseUser: franchise.user,
      buyer: buyerId,
      tier: actualTier,
      quantity: actualQuantity,
      amount,
      currency: 'naira',
      paymentProof,
      paymentProofCloudinaryId,
      buyerBankName: bankName,
      buyerAccountName: accountName,
      buyerReference: reference,
    });

    res.status(201).json({
      success: true,
      message: 'Purchase submitted. The franchise vendor will validate your payment.',
      data: tx,
    });
  } catch (error) {
    console.error('Buy from franchise error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit purchase' });
  }
};

/**
 * @desc    Buyer raises a dispute
 * @route   POST /api/franchise/dispute/:transactionId
 */
exports.raiseDispute = async (req, res) => {
  try {
    const tx = await FranchiseTransaction.findOne({ transactionId: req.params.transactionId, buyer: req.user.id });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (!['pending', 'rejected'].includes(tx.status)) {
      return res.status(400).json({ success: false, message: 'Cannot dispute this transaction' });
    }

    tx.status = 'disputed';
    tx.dispute = {
      raisedBy: req.user.id,
      raisedAt: new Date(),
      reason: req.body.reason || 'Payment made but shares not released',
    };
    await tx.save();

    // Update franchise dispute count
    await Franchise.findByIdAndUpdate(tx.franchise, { $inc: { disputeCount: 1 } });

    res.json({ success: true, message: 'Dispute raised. Admin will review.', data: tx });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to raise dispute' });
  }
};

/**
 * @desc    Get buyer's franchise purchases
 * @route   GET /api/franchise/my-purchases
 */
exports.getMyPurchases = async (req, res) => {
  try {
    const transactions = await FranchiseTransaction.find({ buyer: req.user.id })
      .populate('franchise', 'businessName')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch purchases' });
  }
};

// ==================== ADMIN ====================

/**
 * @desc    List all franchises (admin)
 * @route   GET /api/franchise/admin/list
 */
exports.adminListFranchises = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const franchises = await Franchise.find(filter)
      .populate('user', 'name email phone userName')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: franchises });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to list franchises' });
  }
};

/**
 * @desc    Approve/reject franchise application
 * @route   PUT /api/franchise/admin/:franchiseId/status
 */
exports.adminUpdateStatus = async (req, res) => {
  try {
    const { status } = req.body; // 'active', 'suspended', 'revoked'
    if (!['active', 'suspended', 'revoked'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const franchise = await Franchise.findById(req.params.franchiseId);
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    franchise.status = status;
    if (status === 'active' && !franchise.approvedAt) {
      franchise.approvedAt = new Date();
      franchise.approvedBy = req.user.id;
    }
    await franchise.save();

    // Notify franchise owner
    const owner = await User.findById(franchise.user);
    if (owner?.email) {
      try {
        await sendEmail({
          email: owner.email,
          subject: `AfriMobile Franchise - ${status === 'active' ? 'Approved!' : status === 'suspended' ? 'Suspended' : 'Revoked'}`,
          html: `<h2>Franchise Status Update</h2><p>Your franchise "${franchise.businessName}" has been <strong>${status}</strong>.</p>`
        });
      } catch (e) {}
    }

    res.json({ success: true, message: `Franchise ${status}`, data: franchise });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update franchise status' });
  }
};

/**
 * @desc    Approve franchise bulk purchase (adds to inventory)
 * @route   PUT /api/franchise/admin/:franchiseId/approve-bulk/:purchaseIndex
 */
exports.adminApproveBulk = async (req, res) => {
  try {
    const franchise = await Franchise.findById(req.params.franchiseId);
    if (!franchise) return res.status(404).json({ success: false, message: 'Franchise not found' });

    const purchase = franchise.bulkPurchases[req.params.purchaseIndex];
    if (!purchase) return res.status(404).json({ success: false, message: 'Bulk purchase not found' });
    if (purchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed' });

    purchase.status = 'approved';
    purchase.approvedBy = req.user.id;
    purchase.approvedAt = new Date();

    // Add to inventory
    const tier = purchase.tier;
    const qty = purchase.quantity;

    if (!franchise.inventory.tierInventory.has(tier)) {
      franchise.inventory.tierInventory.set(tier, { purchased: 0, sold: 0, available: 0 });
    }
    const tierInv = franchise.inventory.tierInventory.get(tier);
    tierInv.purchased += qty;
    tierInv.available += qty;
    franchise.inventory.totalSharesPurchased += qty;
    franchise.inventory.availableShares += qty;

    await franchise.save();

    res.json({ success: true, message: 'Bulk purchase approved. Shares added to franchise inventory.', data: { tier, quantity: qty, inventory: tierInv } });
  } catch (error) {
    console.error('Admin approve bulk error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve bulk purchase' });
  }
};

/**
 * @desc    Get all franchise transactions (admin)
 * @route   GET /api/franchise/admin/transactions
 */
exports.adminGetTransactions = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const transactions = await FranchiseTransaction.find(filter)
      .populate('buyer', 'name email phone userName')
      .populate('franchiseUser', 'name email userName')
      .populate('franchise', 'businessName')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
  }
};

/**
 * @desc    Resolve a dispute (admin)
 * @route   PUT /api/franchise/admin/resolve-dispute/:transactionId
 */
exports.adminResolveDispute = async (req, res) => {
  try {
    const { resolution, favorBuyer, adminNotes } = req.body;
    const tx = await FranchiseTransaction.findOne({ transactionId: req.params.transactionId });
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
    if (tx.status !== 'disputed') return res.status(400).json({ success: false, message: 'Transaction is not disputed' });

    tx.dispute.resolvedBy = req.user.id;
    tx.dispute.resolvedAt = new Date();
    tx.dispute.resolution = resolution;
    tx.dispute.adminNotes = adminNotes;

    if (favorBuyer) {
      // Release shares to buyer from franchise inventory
      tx.status = 'resolved_buyer';
      
      const franchise = await Franchise.findById(tx.franchise);
      if (franchise) {
        const tierInv = franchise.inventory.tierInventory.get(tx.tier);
        if (tierInv && tierInv.available >= tx.quantity) {
          tierInv.sold += tx.quantity;
          tierInv.available -= tx.quantity;
          franchise.inventory.totalSharesSold += tx.quantity;
          franchise.inventory.availableShares -= tx.quantity;

          // Add shares to buyer
          const tiers = Share.getTierConfig();
          const tierConfig = tiers[tx.tier];
          let userShare = await UserShare.findOne({ user: tx.buyer });
          if (!userShare) userShare = new UserShare({ user: tx.buyer, transactions: [], totalShares: 0, coFounderShares: 0 });

          const sharesCount = tx.quantity * (tierConfig?.sharesIncluded || 1);
          const isCofounder = tierConfig?.type === 'cofounder';

          userShare.transactions.push({
            transactionId: tx.transactionId,
            type: isCofounder ? 'co-founder' : 'share',
            shares: isCofounder ? 0 : sharesCount,
            coFounderShares: isCofounder ? sharesCount : 0,
            totalAmount: tx.amount,
            currency: tx.currency,
            paymentMethod: 'franchise_dispute_resolved',
            status: 'completed',
            date: new Date(),
            tier: tx.tier,
          });

          if (isCofounder) userShare.coFounderShares += sharesCount;
          else userShare.totalShares += sharesCount;

          tx.sharesReleased = true;
          tx.sharesReleasedAt = new Date();

          await Promise.all([franchise.save(), userShare.save()]);
        }
      }
    } else {
      tx.status = 'resolved_vendor';
    }

    await tx.save();
    res.json({ success: true, message: `Dispute resolved in favor of ${favorBuyer ? 'buyer' : 'vendor'}`, data: tx });
  } catch (error) {
    console.error('Admin resolve dispute error:', error);
    res.status(500).json({ success: false, message: 'Failed to resolve dispute' });
  }
};

/**
 * @desc    Admin franchise dashboard stats
 * @route   GET /api/franchise/admin/stats
 */
exports.adminStats = async (req, res) => {
  try {
    const [totalFranchises, activeFranchises, pendingApps, totalTx, disputedTx, franchises] = await Promise.all([
      Franchise.countDocuments(),
      Franchise.countDocuments({ status: 'active' }),
      Franchise.countDocuments({ status: 'pending' }),
      FranchiseTransaction.countDocuments(),
      FranchiseTransaction.countDocuments({ status: 'disputed' }),
      Franchise.find({ status: 'active' }).select('businessName totalRevenue totalSales disputeCount inventory.availableShares').populate('user', 'name').lean(),
    ]);

    const totalRevenue = franchises.reduce((sum, f) => sum + f.totalRevenue, 0);
    const totalSales = franchises.reduce((sum, f) => sum + f.totalSales, 0);

    res.json({
      success: true,
      data: {
        totalFranchises,
        activeFranchises,
        pendingApplications: pendingApps,
        totalTransactions: totalTx,
        disputedTransactions: disputedTx,
        totalRevenue,
        totalSales,
        franchises,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch franchise stats' });
  }
};
