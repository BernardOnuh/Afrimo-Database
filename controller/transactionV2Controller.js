// controller/transactionV2Controller.js

const TransactionV2        = require('../models/TransactionV2');
const UserShareV2          = require('../models/UserShareV2');
const UserShare            = require('../models/UserShare');
const PaymentTransaction   = require('../models/Transaction');
const User                 = require('../models/User');
const recalculateUserShare = require('../helpers/recalculateUserShare');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v2/transactions
// You pass: totalAmount (full), ownershipPct (per share), earningKobo (per share)
// Controller derives: ownershipPct total = perShare × shares
//                     earningKobo total  = perShare × shares
//                     pricePerShare      = totalAmount ÷ shares
// ─────────────────────────────────────────────────────────────────────────────
exports.createTransaction = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const {
      transactionId, userId, type, shares, tierKey,
      totalAmount, currency,
      ownershipPct,   // per share value
      earningKobo,    // per share value
      status, paymentMethod, paymentProof, note
    } = req.body;

    const missing = [
      'transactionId', 'userId', 'type', 'shares', 'tierKey',
      'totalAmount', 'currency', 'ownershipPct', 'earningKobo'
    ].filter(f => req.body[f] == null);

    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }

    const targetUser = await User.findById(userId).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const existing = await TransactionV2.findOne({ transactionId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Transaction ${transactionId} already exists in v2`,
        existing
      });
    }

    // ── Parse ─────────────────────────────────────────────────────────────────
    const shareCount          = parseInt(shares);
    const totalAmountVal      = parseFloat(totalAmount);
    const ownershipPctPerShare = parseFloat(ownershipPct);   // per share
    const earningKoboPerShare  = parseFloat(earningKobo);    // per share

    // ── Derive totals by multiplying per-share × shares ───────────────────────
    const totalOwnershipPct = ownershipPctPerShare * shareCount;
    const totalEarningKobo  = earningKoboPerShare  * shareCount;
    const pricePerShare     = totalAmountVal       / shareCount;

    const tx = await TransactionV2.create({
      transactionId,
      userId,
      type,
      shares               : shareCount,
      tierKey,

      // Per-share values (what you passed in)
      pricePerShare,
      ownershipPctPerShare,
      earningKoboPerShare,

      // Derived totals (perShare × shares)
      totalAmount          : totalAmountVal,
      ownershipPct         : totalOwnershipPct,
      earningKobo          : totalEarningKobo,

      currency             : currency.toLowerCase(),
      status               : status || 'completed',
      paymentMethod,
      paymentProof,
      enteredBy            : req.user.id,
      note
    });

    const updatedShare = await recalculateUserShare(userId);

    res.status(201).json({
      success: true,
      message: 'Transaction created and user share recalculated.',
      transaction: {
        ...tx.toObject(),
        derivation: {
          pricePerShare    : `${totalAmountVal} ÷ ${shareCount} = ${pricePerShare.toFixed(6)}`,
          totalOwnershipPct: `${ownershipPctPerShare} × ${shareCount} = ${totalOwnershipPct}`,
          totalEarningKobo : `${earningKoboPerShare} × ${shareCount} = ${totalEarningKobo}`
        }
      },
      userShareSnapshot: updatedShare
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate transactionId' });
    }
    console.error('Error creating v2 transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v2/transactions/:transactionId
// Delete a single transaction by transactionId and recalculate user snapshot.
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteTransaction = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { transactionId } = req.params;

    const tx = await TransactionV2.findOne({ transactionId });
    if (!tx) {
      return res.status(404).json({
        success: false,
        message: `Transaction ${transactionId} not found in v2`
      });
    }

    const userId = tx.userId;
    await TransactionV2.deleteOne({ transactionId });

    // Recalculate snapshot after deletion
    const updatedShare = await recalculateUserShare(userId);

    res.status(200).json({
      success: true,
      message: `Transaction ${transactionId} deleted and user share recalculated.`,
      deletedTransaction: tx,
      userShareSnapshot: updatedShare
    });

  } catch (error) {
    console.error('Error deleting v2 transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v2/transactions/:transactionId
// Fix a specific transaction — re-derive totals from corrected per-share values.
// ─────────────────────────────────────────────────────────────────────────────
exports.updateTransaction = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { transactionId } = req.params;

    const tx = await TransactionV2.findOne({ transactionId });
    if (!tx) {
      return res.status(404).json({
        success: false,
        message: `Transaction ${transactionId} not found in v2`
      });
    }

    const {
      totalAmount, ownershipPct, earningKobo,
      shares, tierKey, currency,
      status, paymentMethod, paymentProof, note
    } = req.body;

    // Use existing values as fallback if not provided
    const shareCount          = parseInt(shares          ?? tx.shares);
    const totalAmountVal      = parseFloat(totalAmount   ?? tx.totalAmount);
    const ownershipPctPerShare = parseFloat(ownershipPct ?? tx.ownershipPctPerShare);
    const earningKoboPerShare  = parseFloat(earningKobo  ?? tx.earningKoboPerShare);

    // Re-derive totals
    const totalOwnershipPct = ownershipPctPerShare * shareCount;
    const totalEarningKobo  = earningKoboPerShare  * shareCount;
    const pricePerShare     = totalAmountVal       / shareCount;

    const updated = await TransactionV2.findOneAndUpdate(
      { transactionId },
      {
        shares               : shareCount,
        tierKey              : tierKey      ?? tx.tierKey,
        currency             : (currency    ?? tx.currency).toLowerCase(),
        status               : status       ?? tx.status,
        paymentMethod        : paymentMethod ?? tx.paymentMethod,
        paymentProof         : paymentProof  ?? tx.paymentProof,
        note                 : note          ?? tx.note,

        // Per-share
        pricePerShare,
        ownershipPctPerShare,
        earningKoboPerShare,

        // Derived totals
        totalAmount          : totalAmountVal,
        ownershipPct         : totalOwnershipPct,
        earningKobo          : totalEarningKobo,
      },
      { new: true }
    );

    const updatedShare = await recalculateUserShare(tx.userId);

    res.status(200).json({
      success: true,
      message: `Transaction ${transactionId} updated and user share recalculated.`,
      transaction: {
        ...updated.toObject(),
        derivation: {
          pricePerShare    : `${totalAmountVal} ÷ ${shareCount} = ${pricePerShare.toFixed(6)}`,
          totalOwnershipPct: `${ownershipPctPerShare} × ${shareCount} = ${totalOwnershipPct}`,
          totalEarningKobo : `${earningKoboPerShare} × ${shareCount} = ${totalEarningKobo}`
        }
      },
      userShareSnapshot: updatedShare
    });

  } catch (error) {
    console.error('Error updating v2 transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v2/transactions/user/:userId
// ─────────────────────────────────────────────────────────────────────────────
exports.getUserTransactions = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { userId } = req.params;

    const targetUser = await User.findById(userId)
      .select('name email username createdAt').lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const txs = await TransactionV2.find({ userId })
      .sort({ createdAt: -1 }).lean();

    const completed = txs.filter(t => t.status === 'completed');
    const pending   = txs.filter(t => t.status === 'pending');
    const failed    = txs.filter(t => !['completed', 'pending'].includes(t.status));

    const totalOwnershipPct  = completed.reduce((s, t) => s + (t.ownershipPct  || 0), 0);
    const totalEarningKobo   = completed.reduce((s, t) => s + (t.earningKobo   || 0), 0);
    const totalInvestedNaira = completed
      .filter(t => (t.currency || 'naira') === 'naira')
      .reduce((s, t) => s + (t.totalAmount || 0), 0);
    const totalInvestedUSDT  = completed
      .filter(t => t.currency === 'usdt')
      .reduce((s, t) => s + (t.totalAmount || 0), 0);

    res.status(200).json({
      success: true,
      user: targetUser,
      summary: {
        total              : txs.length,
        completed          : completed.length,
        pending            : pending.length,
        failed             : failed.length,
        totalOwnershipPct  : +totalOwnershipPct.toFixed(7),
        totalEarningKobo,
        totalEarningNaira  : (totalEarningKobo / 100).toFixed(2),
        totalInvestedNaira,
        totalInvestedUSDT
      },
      transactions: txs
    });

  } catch (error) {
    console.error('Error fetching v2 transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v2/transactions/compare/:userId
// ─────────────────────────────────────────────────────────────────────────────
exports.compareUserData = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { userId } = req.params;

    const targetUser = await User.findById(userId)
      .select('name email username createdAt').lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const [oldShare, newShare, oldTxs, newTxs] = await Promise.all([
      UserShare.findOne({ user: userId }).lean(),
      UserShareV2.findOne({ user: userId }).lean(),
      PaymentTransaction.find({ userId }).sort({ createdAt: -1 }).lean(),
      TransactionV2.find({ userId }).sort({ createdAt: -1 }).lean()
    ]);

    const oldOwnership    = oldShare?.totalOwnershipPct || 0;
    const oldCompletedTxs = (oldTxs || []).filter(t => t.status === 'completed');
    const oldNaira        = oldCompletedTxs
      .filter(t => (t.currency || 'naira') === 'naira')
      .reduce((s, t) => s + (t.amount || 0), 0);
    const oldUSDT         = oldCompletedTxs
      .filter(t => t.currency === 'usdt')
      .reduce((s, t) => s + (t.amount || 0), 0);
    const oldEarningKobo  = oldCompletedTxs
      .reduce((s, t) => s + (t.earningKobo || 0), 0);

    const newOwnership   = newShare?.totalOwnershipPct  || 0;
    const newNaira       = newShare?.totalInvestedNaira || 0;
    const newUSDT        = newShare?.totalInvestedUSDT  || 0;
    const newEarningKobo = newShare?.totalEarningKobo   || 0;

    const oldTxIds        = (oldTxs || []).map(t => t.transactionId);
    const duplicatesInOld = oldTxIds.length - new Set(oldTxIds).size;

    res.status(200).json({
      success: true,
      user: targetUser,
      comparison: {
        ownership: {
          old         : +oldOwnership.toFixed(7) + '%',
          new         : +newOwnership.toFixed(7) + '%',
          difference  : +(newOwnership - oldOwnership).toFixed(7) + '%',
          discrepancy : newOwnership !== oldOwnership
        },
        transactions: {
          old            : (oldTxs || []).length,
          new            : (newTxs || []).length,
          difference     : (newTxs || []).length - (oldTxs || []).length,
          duplicatesInOld
        },
        investedNaira : { old: oldNaira,       new: newNaira,       difference: newNaira - oldNaira },
        investedUSDT  : { old: oldUSDT,        new: newUSDT,        difference: newUSDT  - oldUSDT  },
        earningKobo   : { old: oldEarningKobo, new: newEarningKobo, difference: newEarningKobo - oldEarningKobo }
      },
      old: { userShare: oldShare, transactions: oldTxs },
      new: { userShare: newShare, transactions: newTxs }
    });

  } catch (error) {
    console.error('Compare error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to compare data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};