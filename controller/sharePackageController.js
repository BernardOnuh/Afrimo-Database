const SharePackage = require('../models/SharePackage');

// ─── Public ───────────────────────────────────────────────────────────────────

exports.getAllPackages = async (req, res) => {
  try {
    const packages = await SharePackage.find({ isActive: true }).sort({ displayOrder: 1 });
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// ─── Admin — package level ────────────────────────────────────────────────────

exports.getAdminPackages = async (req, res) => {
  try {
    const packages = await SharePackage.find().sort({ displayOrder: 1 });
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.createPackage = async (req, res) => {
  try {
    const {
      name, type, description, priceNaira, priceUSDT,
      ownershipPct, earningKobo, benefits, isActive,
      displayOrder, maxPurchasePerUser, color, icon
    } = req.body;

    if (!name || priceNaira == null || priceUSDT == null) {
      return res.status(400).json({ success: false, message: 'name, priceNaira and priceUSDT are required' });
    }

    const existing = await SharePackage.findOne({ name: new RegExp(`^${name}$`, 'i') });
    if (existing) return res.status(400).json({ success: false, message: `Package "${name}" already exists` });

    const pkg = await SharePackage.create({
      name,
      type: type || 'regular',
      description: description || '',
      priceNaira: Number(priceNaira),
      priceUSDT: Number(priceUSDT),
      ownershipPct: ownershipPct || '0%',
      earningKobo: earningKobo || '0',
      benefits: benefits || [],
      isActive: isActive !== undefined ? isActive : true,
      displayOrder: displayOrder || 0,
      maxPurchasePerUser: maxPurchasePerUser || 0,
      color: color || '#6366f1',
      icon: icon || 'package'
    });

    res.status(201).json({ success: true, package: pkg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.updatePackage = async (req, res) => {
  try {
    const pkg = await SharePackage.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    res.json({ success: true, package: pkg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.deletePackage = async (req, res) => {
  try {
    const { hard } = req.query;
    const pkg = await SharePackage.findById(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    if (hard === 'true') {
      await SharePackage.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: 'Package permanently deleted' });
    }

    pkg.isActive = false;
    await pkg.save();
    res.json({ success: true, message: 'Package deactivated', package: pkg });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.reorderPackages = async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ success: false, message: 'orders array required' });
    }
    const ops = orders.map(o => ({
      updateOne: { filter: { _id: o.id }, update: { displayOrder: o.displayOrder } }
    }));
    await SharePackage.bulkWrite(ops);
    const packages = await SharePackage.find().sort({ displayOrder: 1 });
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.adminEditPackageFields = async (req, res) => {
  try {
    const User = require('../models/User');
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const pkg = await SharePackage.findById(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    const {
      name, type, priceNaira, priceUSDT, ownershipPct,
      earningKobo, benefits, isActive, displayOrder,
      description, color, icon
    } = req.body;

    if (name !== undefined) pkg.name = name;
    if (type !== undefined) pkg.type = type;
    if (priceNaira !== undefined) pkg.priceNaira = Number(priceNaira);
    if (priceUSDT !== undefined) pkg.priceUSDT = Number(priceUSDT);
    if (ownershipPct !== undefined) pkg.ownershipPct = ownershipPct;
    if (earningKobo !== undefined) pkg.earningKobo = earningKobo;
    if (benefits !== undefined) pkg.benefits = benefits;
    if (isActive !== undefined) pkg.isActive = isActive;
    if (displayOrder !== undefined) pkg.displayOrder = Number(displayOrder);
    if (description !== undefined) pkg.description = description;
    if (color !== undefined) pkg.color = color;
    if (icon !== undefined) pkg.icon = icon;

    await pkg.save();

    res.status(200).json({
      success: true,
      message: `Package "${pkg.name}" updated successfully`,
      package: pkg
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// ─── Admin — user level ───────────────────────────────────────────────────────

const resolveUser = async (identifier) => {
  const mongoose = require('mongoose');
  const User = require('../models/User');
  let user = null;
  if (mongoose.Types.ObjectId.isValid(identifier)) user = await User.findById(identifier);
  if (!user) user = await User.findOne({ $or: [{ email: identifier }, { userName: identifier }] });
  return user;
};

exports.adminGetUserPurchasedPackages = async (req, res) => {
  try {
    const User = require('../models/User');
    const UserShare = require('../models/UserShare');
    const PaymentTransaction = require('../models/Transaction');

    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const paymentTransactions = await PaymentTransaction.find({
      userId: user._id
    }).sort({ createdAt: -1 });

    const userShare = await UserShare.findOne({ user: user._id });

    const purchases = paymentTransactions.map(tx => {
      const userShareTx = userShare
        ? userShare.transactions.find(t => t.transactionId === tx.transactionId)
        : null;

      return {
        transactionId: tx.transactionId,
        mongoId: tx._id,
        packageType: tx.type,
        paymentMethod: tx.paymentMethod,
        status: tx.status,
        shares: tx.shares,
        coFounderShares: userShareTx?.coFounderShares || null,
        amount: tx.amount,
        currency: tx.currency,
        pricePerShare: tx.shares ? Number((tx.amount / tx.shares).toFixed(2)) : 0,
        ownershipPct: userShareTx?.ownershipPct || tx.ownershipPct || null,
        earningKobo: userShareTx?.earningKobo || tx.earningKobo || null,
        benefits: userShareTx?.benefits || [],
        tier: tx.tier || null,
        tierBreakdown: tx.tierBreakdown || null,
        adminNote: tx.adminNotes || userShareTx?.adminNote || null,
        verifiedBy: tx.verifiedBy || null,
        verifiedAt: tx.verifiedAt || null,
        hasPaymentProof: !!(tx.paymentProofCloudinaryUrl || tx.paymentProofPath),
        paymentProofUrl: tx.paymentProofCloudinaryUrl || tx.paymentProofPath || null,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt
      };
    });

    const completed = purchases.filter(p => p.status === 'completed');

    const summary = {
      totalTransactions: purchases.length,
      completed: completed.length,
      pending: purchases.filter(p => p.status === 'pending').length,
      failed: purchases.filter(p => p.status === 'failed').length,
      totalRegularShares: completed
        .filter(p => p.packageType === 'share')
        .reduce((sum, p) => sum + (p.shares || 0), 0),
      totalCoFounderShares: completed
        .filter(p => p.packageType === 'co-founder')
        .reduce((sum, p) => sum + (p.coFounderShares || p.shares || 0), 0),
      totalSpentNaira: completed
        .filter(p => p.currency === 'naira')
        .reduce((sum, p) => sum + (p.amount || 0), 0),
      totalSpentUSDT: completed
        .filter(p => p.currency === 'usdt')
        .reduce((sum, p) => sum + (p.amount || 0), 0)
    };

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        username: user.userName,
        email: user.email,
        phone: user.phone
      },
      summary,
      purchases,
      editEndpoint: `PATCH /api/share-packages/user/${user._id}/edit`
    });

  } catch (err) {
    console.error('adminGetUserPurchasedPackages error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.adminEditUserSharePackage = async (req, res) => {
  try {
    const User = require('../models/User');
    const UserShare = require('../models/UserShare');
    const PaymentTransaction = require('../models/Transaction');

    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const {
      transactionId,
      ownershipPct,
      earningKobo,
      shares,
      coFounderShares,
      status,
      adminNote,
      pricePerShare,
      totalAmount,
      currency,
      paymentMethod,
      benefits
    } = req.body;

    if (transactionId) {
      // ── Edit one specific transaction ────────────────────────────────────────

      const paymentTx = await PaymentTransaction.findOne({ transactionId });
      if (!paymentTx) {
        return res.status(404).json({ success: false, message: `Transaction ${transactionId} not found` });
      }

      if (paymentTx.userId.toString() !== user._id.toString()) {
        return res.status(403).json({ success: false, message: 'This transaction does not belong to this user' });
      }

      if (shares !== undefined) paymentTx.shares = Number(shares);
      if (status !== undefined) paymentTx.status = status;
      if (adminNote !== undefined) paymentTx.adminNotes = adminNote;
      if (totalAmount !== undefined) paymentTx.amount = Number(totalAmount);
      if (currency !== undefined) paymentTx.currency = currency;
      if (paymentMethod !== undefined) paymentTx.paymentMethod = paymentMethod;
      if (ownershipPct !== undefined) paymentTx.ownershipPct = ownershipPct;
      if (earningKobo !== undefined) paymentTx.earningKobo = earningKobo;
      paymentTx.verifiedBy = req.user.id;
      paymentTx.verifiedAt = new Date();
      await paymentTx.save();

      // Sync to UserShare
      const userShare = await UserShare.findOne({
        user: user._id,
        'transactions.transactionId': transactionId
      });

      if (userShare) {
        const txIndex = userShare.transactions.findIndex(t => t.transactionId === transactionId);
        if (txIndex !== -1) {
          const tx = userShare.transactions[txIndex];
          if (shares !== undefined) tx.shares = Number(shares);
          if (coFounderShares !== undefined) tx.coFounderShares = Number(coFounderShares);
          if (status !== undefined) tx.status = status;
          if (adminNote !== undefined) tx.adminNote = adminNote;
          if (pricePerShare !== undefined) tx.pricePerShare = Number(pricePerShare);
          if (totalAmount !== undefined) tx.totalAmount = Number(totalAmount);
          if (currency !== undefined) tx.currency = currency;
          if (paymentMethod !== undefined) tx.paymentMethod = paymentMethod;
          if (ownershipPct !== undefined) tx.ownershipPct = ownershipPct;
          if (earningKobo !== undefined) tx.earningKobo = earningKobo;
          if (benefits !== undefined) tx.benefits = benefits;
          userShare.transactions[txIndex] = tx;
          userShare.markModified('transactions');

          userShare.totalShares = userShare.transactions
            .filter(t => t.status === 'completed' && t.paymentMethod !== 'co-founder')
            .reduce((sum, t) => sum + (t.shares || 0), 0);

          await userShare.save();
        }
      }

      return res.status(200).json({
        success: true,
        message: `Transaction ${transactionId} updated for user ${user.name}`,
        user: { id: user._id, name: user.name, email: user.email },
        updatedTransaction: {
          transactionId,
          ...(shares !== undefined && { shares }),
          ...(coFounderShares !== undefined && { coFounderShares }),
          ...(status !== undefined && { status }),
          ...(ownershipPct !== undefined && { ownershipPct }),
          ...(earningKobo !== undefined && { earningKobo }),
          ...(pricePerShare !== undefined && { pricePerShare }),
          ...(totalAmount !== undefined && { totalAmount }),
          ...(adminNote !== undefined && { adminNote }),
          ...(benefits !== undefined && { benefits })
        }
      });
    }

    // ── No transactionId — edit ALL transactions for this user ────────────────

    const userShare = await UserShare.findOne({ user: user._id });
    if (!userShare) {
      return res.status(404).json({ success: false, message: 'No share record found for this user' });
    }

    let updatedCount = 0;
    userShare.transactions.forEach((tx, i) => {
      if (ownershipPct !== undefined) userShare.transactions[i].ownershipPct = ownershipPct;
      if (earningKobo !== undefined) userShare.transactions[i].earningKobo = earningKobo;
      if (adminNote !== undefined) userShare.transactions[i].adminNote = adminNote;
      if (benefits !== undefined) userShare.transactions[i].benefits = benefits;
      updatedCount++;
    });

    userShare.markModified('transactions');
    await userShare.save();

    const bulkUpdate = {};
    if (ownershipPct !== undefined) bulkUpdate.ownershipPct = ownershipPct;
    if (earningKobo !== undefined) bulkUpdate.earningKobo = earningKobo;
    if (adminNote !== undefined) bulkUpdate.adminNotes = adminNote;

    if (Object.keys(bulkUpdate).length > 0) {
      await PaymentTransaction.updateMany({ userId: user._id }, { $set: bulkUpdate });
    }

    return res.status(200).json({
      success: true,
      message: `Updated ${updatedCount} transactions for user ${user.name}`,
      user: { id: user._id, name: user.name, email: user.email },
      updatedFields: {
        ...(ownershipPct !== undefined && { ownershipPct }),
        ...(earningKobo !== undefined && { earningKobo }),
        ...(adminNote !== undefined && { adminNote }),
        ...(benefits !== undefined && { benefits })
      },
      totalUpdated: updatedCount
    });

  } catch (err) {
    console.error('adminEditUserSharePackage error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

exports.getPackageByName = async (name) => {
  return SharePackage.findOne({ name: new RegExp(`^${name}$`, 'i'), isActive: true });
};