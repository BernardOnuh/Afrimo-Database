/**
 * ADMIN WITHDRAWAL CONTROL CONTROLLER
 * Provides intensive admin controls over the withdrawal system
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const WithdrawalConfig = require('../models/WithdrawalConfig');
const UserWithdrawalControl = require('../models/UserWithdrawalControl');
const { sendEmail } = require('../utils/emailService');

// ─── HELPERS ────────────────────────────────────────────────────────────────

async function getConfig(key, defaultValue = null) {
  const doc = await WithdrawalConfig.findOne({ key });
  return doc ? doc.value : defaultValue;
}

async function setConfig(key, va), reason },
    { upsert: true, new: true }
  );
}

async function findUserByIdentifier(identifier) {
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const u = await User.findById(identifier);
    if (u) return u;
  }
  return User.findOne({ $or: [{ username: identifier }, { email: identifier }] });
}

// ─── GLOBAL SYSTEM STATUS ────────────────────────────────────────────────────

/**
 * GET /api/withdrawal/admin/control/status
 * Returns the full system-wide withdrawal configuration
 */
exports.getSystemStatus = async (req, res) => {
  try {
    const [
      globalPaused,
      globalPauseReason,
      emergencyFreeze,
      emergencyFreezeReason,
      globalMinLimit,
      globalMaxLimit,
      bankEnabled,
      cryptoEnabled
    ] = await Promise.all([
      getConfig('global_paused', false),
      getConfig('global_pause_reason', null),
      getConfig('emergency_freeze', false),
'global_max_limit', null),
      getConfig('bank_withdrawals_enabled', true),
      getConfig('crypto_withdrawals_enabled', true)
    ]);

    const pendingCount = await Withdrawal.countDocuments({ status: { $in: ['pending', 'processing'] } });
    const blacklistedCount = await UserWithdrawalControl.countDocuments({ isBlacklisted: true });
    const pausedUsersCount = await UserWithdrawalControl.countDocuments({ isPaused: true });

    res.json({
      success: true,
      data: {
        system: {
          globalPaused,
          globalPauseReason,
          emergencyFreeze,
          emergencyFreezeReason,
          bankWithdrawalsEnabled: bankEnabled,
          cryptoWithdrawalsEnabled: cryptoEnabled
        },
        limits: {
          globalMinLimit,
          globalMaxLimit
        },
        stats: {
          pendingWithdrawals: pendingCount,
          blacklistedUsers: blacklistedCount,
          pausedUsers: pausedUsersCount
        }
      }
    });
  } catch (error) {
    console.error('getSystemStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch system status' });
  }
};

// ─── GLOBAL PAUSE / RESUME ────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/pause
 * Pause ALL withdrawals (bank + crypto) system-wide
 */
exports.pauseAllWithdrawals = async (req, res) => {
  try {
    const { reason = 'Administrative hold' } = req.body;

    await Promise.all([
      setConfig('global_paused', true, req.user.id, reason),
      setConfig('global_pause_reason', reason, req.user.id, reason)
    ]);

    console.log(`[ADMIN] ALL withdrawals PAUSED by ${req.user.id}. Reason: ${reason}`);

    res.json({
      success: true,
      message: 'All withdrawals have been paused',
      data: { paused: true, reason, pausedBy: req.user.id, pausedAt: new Date() }
    });
  } catch (error) {
    console.error('pauseAllWithdr }
};

/**
 * POST /api/withdrawal/admin/control/resume
 * Resume all withdrawals
 */
exports.resumeAllWithdrawals = async (req, res) => {
  try {
    const { reason = 'Administrative hold lifted' } = req.body;

    await Promise.all([
      setConfig('global_paused', false, req.user.id, reason),
      setConfig('global_pause_reason', null, req.user.id, reason)
    ]);

    console.log(`[ADMIN] ALL withdrawals RESUMED by ${req.user.id}`);

    res.json({
      success: true,
      message: 'All withdrawals have been resumed',
      data: { paused: false, resumedBy: req.user.id, resumedAt: new Date() }
    });
  } catch (error) {
    console.error('resumeAllWithdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to resume withdrawals' });
  }
};

// ─── CHANNEL TOGGLES ─────────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/adm> {
  try {
    const { enabled, reason } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: '"enabled" must be a boolean' });
    }

    await setConfig('bank_withdrawals_enabled', enabled, req.user.id, reason);

    res.json({
      success: true,
      message: `Bank withdrawals ${enabled ? 'enabled' : 'disabled'}`,
      data: { bankWithdrawalsEnabled: enabled, reason }
    });
  } catch (error) {
    console.error('toggleBankWithdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle bank withdrawals' });
  }
};

/**
 * POST /api/withdrawal/admin/control/toggle-crypto
 * Enable or disable crypto-only withdrawals
 */
exports.toggleCryptoWithdrawals = async (req, res) => {
  try {
    const { enabled, reason } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: '"enabled" must be a boolean' });
    }

    await setConfig('crypto_withdrawals_enabled', enabled, req.user.id, reason);

    res.json({
      success: true,
      message: `Crypto withdrawals ${enabled ? 'enabled' : 'disabled'}`,
      data: { cryptoWithdrawalsEnabled: enabled, reason }
    });
  } catch (error) {
    console.error('toggleCryptoWithdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle crypto withdrawals' });
  }
};

// ─── EMERGENCY FREEZE ─────────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/emergency-freeze
 * Hard freeze: blocks all withdrawals AND emails every affected user
 */
exports.emergencyFreeze = async (req, res) => {
  try {
    const { reason = 'Emergency system maintenance' } = req.body;

    await Promise.all([
      setConfig('emergency_freeze', true, req.user.id, reason),
      setConfig('emergency_freeze_reason', reason, req.user.id, reason),
      s)
    ]);

    console.log(`[ADMIN] EMERGENCY FREEZE activated by ${req.user.id}. Reason: ${reason}`);

    // Find all users with pending/processing withdrawals and notify them
    const activeWithdrawals = await Withdrawal.find({
      status: { $in: ['pending', 'processing'] }
    }).populate('user', 'name email');

    const uniqueUsers = [];
    const seenIds = new Set();
    for (const w of activeWithdrawals) {
      if (w.user && !seenIds.has(w.user._id.toString())) {
        seenIds.add(w.user._id.toString());
        uniqueUsers.push(w.user);
      }
    }

    let notified = 0;
    for (const user of uniqueUsers) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Important: Withdrawal System Maintenance',
          html: `
            <h2>Withdrawal System Temporarily Unavailable</h2>
            <p>Hello ${user.name},</p>
            <p>We are currently undergoing emergency maintenance on our withdrawal system.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Your pending withdrawal(s) are safe and will be processed once maintenance is complete. We apologize for the inconvenience.</p>
            <p>Thank you for your patience.</p>
            <p><em>— The Afrimobile Team</em></p>
          `
        });
        notified++;
      } catch (emailErr) {
        console.error(`Failed to notify user ${user.email}:`, emailErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Emergency freeze activated',
      data: {
        frozen: true,
        reason,
        frozenBy: req.user.id,
        frozenAt: new Date(),
        usersNotified: notified,
        activeWithdrawalsAffected: activeWithdrawals.length
      }
    });
  } catch (error) {
    console.error('emergencyFreeze error:', error);
    res.status(500).json({ success: false, message: 'Failed to activate emergency freeze' });
  }
};

/**
 * POST /api/withdrawal/admin/control/unfreeze
 * Lift the emergency freeze
 */
exports.liftEmergencyFreeze = async (req,es) => {
  try {
    const { reason = 'Maintenance complete' } = req.body;

    await Promise.all([
      setConfig('emergency_freeze', false, req.user.id, reason),
      setConfig('emergency_freeze_reason', null, req.user.id, reason),
      setConfig('global_paused', false, req.user.id, reason),
      setConfig('global_pause_reason', null, req.user.id, reason)
    ]);

    console.log(`[ADMIN] Emergency freeze LIFTED by ${req.user.id}`);

    res.json({
      success: true,
      message: 'Emergency freeze lifted, withdrawals resumed',
      data: { frozen: false, liftedBy: req.user.id, liftedAt: new Date() }
    });
  } catch (error) {
    console.error('liftEmergencyFreeze error:', error);
    res.status(500).json({ success: false, message: 'Failed to lift freeze' });
  }
};

// ─── GLOBAL LIMITS ────────────────────────────────────────────────────────────

/**
 * POST /api/withdr    const { minLimit, maxLimit, reason } = req.body;

    const updates = [];
    if (minLimit !== undefined) {
      if (minLimit < 0) return res.status(400).json({ success: false, message: 'minLimit must be >= 0' });
      updates.push(setConfig('global_min_limit', minLimit, req.user.id, reason));
    }
    if (maxLimit !== undefined) {
      if (maxLimit !== null && maxLimit < 1) return res.status(400).json({ success: false, message: 'maxLimit must be >= 1 or null' });
      updates.push(setConfig('global_max_limit', maxLimit, req.user.id, reason));
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide minLimit and/or maxLimit' });
    }

    await Promise.all(updates);

    const [newMin, newMax] = await Promise.all([
      getConfig('global_min_limit', 20000),
      getConfig('global_max_limit', null)
    ]);

    res.json({
      success: true,
      message: 'Global withdrawal limits updated',
      data: { globalMinLimit: newMin, globalMaxLimit: newMax, reason }
    });
  } catch (error) {
    console.error('setGlobalLimits error:', error);
    res.status(500).json({ success: false, message: 'Failed to set limits' });
  }
};

// ─── PER-USER PAUSE ──────────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/user/:identifier/pause
 * Pause a specific user's withdrawals
 */
exports.pauseUserWithdrawals = async (req, res) => {
  try {
    const { identifier } = req.params;
    const { reason = 'Administrative review' } = req.body;

    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ success: false, message: `User not found: ${identifier}` });

    await UserWithdrawalControl.findOneAndUpdate(
      { user: user._id },
      {
        isPaused: true,
        pauseReason: reason,
        pausedBy: req.user.id,
        pausedAt: new Date(),
   thdrawals PAUSED by ${req.user.id}. Reason: ${reason}`);

    res.json({
      success: true,
      message: `Withdrawals paused for ${user.name}`,
      data: { userId: user._id, username: user.username, isPaused: true, reason }
    });
  } catch (error) {
    console.error('pauseUserWithdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to pause user withdrawals' });
  }
};

/**
 * POST /api/withdrawal/admin/control/user/:identifier/resume
 * Resume a specific user's withdrawals
 */
exports.resumeUserWithdrawals = async (req, res) => {
  try {
    const { identifier } = req.params;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ success: false, message: `User not found: ${identifier}` });

    await UserWithdrawalControl.findOneAndUpdate(
      { user: user._id },
      { isPaused: false, pauseReason: null, pausedBy: null, pausedAt: null, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: `Withdrawals resumed for ${user.name}`,
      data: { userId: user._id, username: user.username, isPaused: false }
    });
  } catch (error) {
    console.error('resumeUserWithdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to resume user withdrawals' });
  }
};

// ─── BLACKLIST / WHITELIST ────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/user/:identifier/blacklist
 */
exports.blacklistUser = async (req, res) => {
  try {
    const { identifier } = req.params;
    const { reason = 'Policy violation' } = req.body;

    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ success: false, message: `User not found: ${identifier}` });

    await UserWithdrawalControl.findOneAndUpdate(
      { user: user._id },
      {
        isBlacklisted:acklistedAt: new Date(),
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    console.log(`[ADMIN] User ${user._id} BLACKLISTED by ${req.user.id}. Reason: ${reason}`);

    res.json({
      success: true,
      message: `User ${user.name} has been blacklisted from withdrawals`,
      data: { userId: user._id, username: user.username, isBlacklisted: true, reason }
    });
  } catch (error) {
    console.error('blacklistUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to blacklist user' });
  }
};

/**
 * POST /api/withdrawal/admin/control/user/:identifier/whitelist
 */
exports.whitelistUser = async (req, res) => {
  try {
    const { identifier } = req.params;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ success: false, message: `User not found: ${identifier}` });

    await UserWithdrawalControl.findOneAndUpdate(
      { user: user._id },
      {
        isBlacklisted: false,
        isPaused: false,
        blacklistReason: null,
        blacklistedBy: null,
        blacklistedAt: null,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: `User ${user.name} has been whitelisted`,
      data: { userId: user._id, username: user.username, isBlacklisted: false, isPaused: false }
    });
  } catch (error) {
    console.error('whitelistUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to whitelist user' });
  }
};

// ─── PER-USER LIMITS ─────────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/user/:identifier/limits
 * Set custom min/max limits for a specific user (overrides global)
 */
exports.setUserLimits = async (req, res) => {
  try {
    const { identifier } = req.params;
    const { minLimit, maxLimit } = req.body;

ssage: `User not found: ${identifier}` });

    const update = { updatedAt: new Date() };
    if (minLimit !== undefined) update.customMinLimit = minLimit === null ? null : Number(minLimit);
    if (maxLimit !== undefined) update.customMaxLimit = maxLimit === null ? null : Number(maxLimit);

    const control = await UserWithdrawalControl.findOneAndUpdate(
      { user: user._id },
      update,
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: `Custom limits set for ${user.name}`,
      data: {
        userId: user._id,
        username: user.username,
        customMinLimit: control.customMinLimit,
        customMaxLimit: control.customMaxLimit
      }
    });
  } catch (error) {
    console.error('setUserLimits error:', error);
    res.status(500).json({ success: false, message: 'Failed to set user limits' });
  }
};

// ─── FORCE CANCEL PENDING ─────────────────────────────────────

// ─── ADDITIONAL REQUIRES (append to top of file manually if needed) ──────────
// These are used by the functions below. If your file already has mongoose/User
// imported at the top, these won't conflict — they're no-ops if already defined.
const WithdrawalAuditLog = require('../models/WithdrawalAuditLog');
const WithdrawalSchedule = require('../models/WithdrawalSchedule');

// ─── AUDIT LOG HELPER ────────────────────────────────────────────────────────

async function auditLog(action, adminId, options = {}) {
  try {
    await WithdrawalAuditLog.create({
      action,
      performedBy: adminId,
      targetUser: options.targetUser || null,
      targetWithdrawal: options.targetWithdrawal || null,
      reason: options.reason || null,
      metadata: options.metadata || null,
      ip: optiomessage);
  }
}

// ─── PATCHED VERSIONS OF EXISTING FUNCTIONS WITH AUDIT LOGGING ───────────────
// These wrap the existing exports to inject audit logging without touching
// the original logic. They override the existing exports on the module.

const _origPauseAll = exports.pauseAllWithdrawals;
exports.pauseAllWithdrawals = async (req, res) => {
  const origJson = res.json.bind(res);
  res.json = async (body) => {
    if (body.success) {
      await auditLog('GLOBAL_PAUSE', req.user.id, {
        reason: req.body.reason,
        ip: req.ip,
        metadata: { pausedAt: new Date() }
      });
    }
    return origJson(body);
  };
  return _origPauseAll(req, res);
};

const _origResumeAll = exports.resumeAllWithdrawals;
exports.resumeAllWithdrawals = async (req, res) => {
  const origJson = res.json.bind(res);
  res.json = async (body) => {
    if (body.success) {
      await auditLog('GLOBAL_RESUME', req.user.id, {
        reason: req.body.reason,
        ip: req.ip
  dy);
  };
  return _origResumeAll(req, res);
};

const _origFreeze = exports.emergencyFreeze;
exports.emergencyFreeze = async (req, res) => {
  const origJson = res.json.bind(res);
  res.json = async (body) => {
    if (body.success) {
      await auditLog('EMERGENCY_FREEZE', req.user.id, {
        reason: req.body.reason,
        ip: req.ip,
        metadata: {
          usersNotified: body.data?.usersNotified,
          activeWithdrawalsAffected: body.data?.activeWithdrawalsAffected
        }
      });
    }
    return origJson(body);
  };
  return _origFreeze(req, res);
};

// ─── AUDIT LOG ENDPOINTS ─────────────────────────────────────────────────────

/**
 * GET /api/withdrawal/admin/control/audit-log
 * Full audit trail with filters
 */
exports.getAuditLog = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      adminId,
      targetUserId,
      stadminId) query.performedBy = adminId;
    if (targetUserId) query.targetUser = targetUserId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const logs = await WithdrawalAuditLog.find(query)
      .populate('performedBy', 'name email username')
      .populate('targetUser', 'name email username')
      .populate('targetWithdrawal', 'amount status clientReference')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const count = await WithdrawalAuditLog.countDocuments(query);

    // Group by action type for summary
    const actionSummary = await WithdrawalAuditLog.aggregate([
      { $match: query },
      { $group: { _id: '$action', count: { $sum: 1 }, lastOccurred: { $max: '$createdAt' } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      count,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page),
      actionSummary,
      data: logs.map(l => ({
        id: l._id,
        action: l.action,
        performedBy: l.performedBy ? `${l.performedBy.name} (${l.performedBy.email})` : 'System',
        targetUser: l.targetUser ? `${l.targetUser.name} (${l.targetUser.email})` : null,
        targetWithdrawal: l.targetWithdrawal || null,
        reason: l.reason,
        metadata: l.metadata,
        ip: l.ip,
        createdAt: l.createdAt
      }))
    });
  } catch (error) {
    console.error('getAuditLog error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch audit log' });
  }
};

// ─── BULK OPERATIONS ─────────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/bulk/cancel-pending
 * Cancel ALL pending withdrawals system-wide (nuclear optioncellation by admin', dryRun = false } = req.body;

    const pendingWithdrawals = await Withdrawal.find({
      status: { $in: ['pending', 'processing'] }
    }).populate('user', 'name email');

    if (pendingWithdrawals.length === 0) {
      return res.json({
        success: true,
        message: 'No pending withdrawals found',
        data: { cancelled: 0, dryRun }
      });
    }

    if (dryRun) {
      // Preview only — don't actually cancel
      return res.json({
        success: true,
        message: `DRY RUN: Would cancel ${pendingWithdrawals.length} withdrawals`,
        data: {
          dryRun: true,
          wouldCancel: pendingWithdrawals.length,
          totalAmountRefunded: pendingWithdrawals.reduce((s, w) => s + w.amount, 0),
          breakdown: {
            pending: pendingWithdrawals.filter(w => w.status === 'pending').length,
            processing: pendingWithdrawals.filter(w => w.status === 'processing').length
          },
          withdrawals: pendingWithdrawals.slice(0, 1.map(w => ({
            id: w._id,
            amount: w.amount,
            status: w.status,
            user: w.user?.email
          }))
        }
      });
    }

    // Group by user for efficient balance updates
    const userRefunds = {};
    for (const w of pendingWithdrawals) {
      const uid = w.user._id.toString();
      if (!userRefunds[uid]) userRefunds[uid] = { pendingRefund: 0, processingRefund: 0 };
      if (w.status === 'pending') userRefunds[uid].pendingRefund += w.amount;
      if (w.status === 'processing') userRefunds[uid].processingRefund += w.amount;
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Cancel all withdrawals
      await Withdrawal.updateMany(
        { status: { $in: ['pending', 'processing'] } },
        {
          status: 'cancelled',
          rejectionReason: reason,
          adminNotes: `Bulk cancelled by admin ${req.user.id} at ${new Date().toISOString()}`
        },
        { session }
      );

      // Refund all users
      for (const [userId, refunds] of Object.entries(userRefunds)) {
        await Referral.findOneAndUpdate(
          { user: userId },
          {
            $inc: {
              pendingWithdrawals: -refunds.pendingRefund,
              processingWithdrawals: -refunds.processingRefund
            }
          },
          { session }
        );
      }

      await session.commitTransaction();
      session.endSession();

      const totalRefunded = pendingWithdrawals.reduce((s, w) => s + w.amount, 0);

      await auditLog('WITHDRAWAL_BULK_CANCELLED', req.user.id, {
        reason,
        ip: req.ip,
        metadata: {
          totalCancelled: pendingWithdrawals.length,
          totalRefunded,
          usersAffected: Object.keys(userRefunds).length
        }
      });

      console.log(`[ADMIN] BULK CANCEL: ${pendingWithdrawals.length} withdrawals cancelled by ${req.user.id}`);

      res.json({
        success: true,
        message: `Cancelled ${pendingWithdrawals.length} withdrawals and refunded ₦${totalRefunded.toLocaleString()}`,
        data: {
          cancelled: pendingWithdrawals.length,
          totalRefunded,
          usersAffected: Object.keys(userRefunds).length,
          reason
        }
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  } catch (error) {
    console.error('bulkCancelAllPendingWithdrawals error:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk cancel withdrawals' });
  }
};

/**
 * POST /api/withdrawal/admin/control/bulk/pause-users
 * Pause withdrawals for multiple users at once
 * Body: { userIdentifiers: ["id1","email2","username3"], reason: "..." }
 */
exports.bulkPauseUsers = async (req, res) => {
  try {
    const { userIdentifiers = [], reason = 'Bulk administrative hold' } = req.body;

    if (!Array.isArray(userIdentifiers) || userIdentifiers.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide an aay of userIdentifiers' });
    }

    if (userIdentifiers.length > 100) {
      return res.status(400).json({ success: false, message: 'Maximum 100 users per bulk operation' });
    }

    const results = { paused: [], notFound: [], alreadyPaused: [] };

    for (const identifier of userIdentifiers) {
      const user = await findUserByIdentifier(identifier);
      if (!user) {
        results.notFound.push(identifier);
        continue;
      }

      const existing = await UserWithdrawalControl.findOne({ user: user._id });
      if (existing?.isPaused) {
        results.alreadyPaused.push({ id: user._id, email: user.email });
        continue;
      }

      await UserWithdrawalControl.findOneAndUpdate(
        { user: user._id },
        {
          isPaused: true,
          pauseReason: reason,
          pausedBy: req.user.id,
          pausedAt: new Date(),
          updatedAt: new Date()
        },
        { upsert: true }
      );

      await auditLog('USER_PAUSED', req.user.id, {
        targetUser: user._id,
        reason,
        ip: req.ip
      });

      results.paused.push({ id: user._id, email: user.email, name: user.name });
    }

    res.json({
      success: true,
      message: `Bulk pause complete: ${results.paused.length} paused, ${results.notFound.length} not found, ${results.alreadyPaused.length} already paused`,
      data: results
    });
  } catch (error) {
    console.error('bulkPauseUsers error:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk pause users' });
  }
};

/**
 * POST /api/withdrawal/admin/control/bulk/blacklist-users
 * Blacklist multiple users at once
 */
exports.bulkBlacklistUsers = async (req, res) => {
  try {
    const { userIdentifiers = [], reason = 'Bulk policy violation' } = req.body;

    if (!Array.isArray(userIdentifiers) || userIdentifiers.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide an array of userIdentifiers' });
    }

    if (userIdentifiers.length > 100) {
      return res.status(400).json({ success: false, message: 'Maximum 100 users per bulk operation' });
    }

    const results = { blacklisted: [], notFound: [], alreadyBlacklisted: [] };

    for (const identifier of userIdentifiers) {
      const user = await findUserByIdentifier(identifier);
      if (!user) {
        results.notFound.push(identifier);
        continue;
      }

      const existing = await UserWithdrawalControl.findOne({ user: user._id });
      if (existing?.isBlacklisted) {
        results.alreadyBlacklisted.push({ id: user._id, email: user.email });
        continue;
      }

      await UserWithdrawalControl.findOneAndUpdate(
        { user: user._id },
        {
          isBlacklisted: true,
          isPaused: true,
          blacklistReason: reason,
          blacklistedBy: req.user.id,
          blacklistedAt: new Date(),
          updatedAt: new Date()
        },
        { upsert: true }
      );

      await auditLog('USER_BLACKLISTED', req.user.id, {
        targetUser: user._id,
        reason,
        ip: req.ip
      });

      results.blacklisted.push({ id: user._id, email: user.email, name: user.name });
    }

    res.json({
      success: true,
      message: `Bulk blacklist complete: ${results.blacklisted.length} blacklisted`,
      data: results
    });
  } catch (error) {
    console.error('bulkBlacklistUsers error:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk blacklist users' });
  }
};

// ─── SCHEDULED CONTROLS ───────────────────────────────────────────────────────

/**
 * POST /api/withdrawal/admin/control/schedule
 * Schedule a future action (e.g. auto-resume after maintenance)
 * Body: { action: "RESUME_ALL", scheduledFor: "2025-08-01T06:00:00Z", reason: "..." }
 */
exports.scheduleControl = async (req, res) => {
  try {
    const { action, scheduledFor, reason } = req.body;

    const validActions = ['RESUME_ALL', 'PAUSE_ALL', 'ENAB res.status(400).json({
        success: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }

    const scheduleDate = new Date(scheduledFor);
    if (isNaN(scheduleDate.getTime()) || scheduleDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'scheduledFor must be a valid future date'
      });
    }

    const schedule = await WithdrawalSchedule.create({
      action,
      scheduledFor: scheduleDate,
      reason,
      createdBy: req.user.id
    });

    res.json({
      success: true,
      message: `Scheduled ${action} for ${scheduleDate.toISOString()}`,
      data: {
        id: schedule._id,
        action,
        scheduledFor: scheduleDate,
        reason,
        createdBy: req.user.id
      }
    });
  } catch (error) {
    console.error('scheduleControl error:', error);
    res.status(500).json({ success: false, message: 'Failed to schedule control' });
  }
};

/**
 * GET /api/withdrawal/admin/control/schedules
 * List all pending scheduled controls
 */
exports.getScheduledControls = async (req, res) => {
  try {
    const schedules = await WithdrawalSchedule.find({ executed: false, cancelled: false })
      .populate('createdBy', 'name email')
      .sort({ scheduledFor: 1 });

    res.json({
      success: true,
      count: schedules.length,
      data: schedules.map(s => ({
        id: s._id,
        action: s.action,
        scheduledFor: s.scheduledFor,
        reason: s.reason,
        createdBy: s.createdBy?.name,
        createdAt: s.createdAt,
        timeUntilExecution: Math.max(0, Math.round((s.scheduledFor - Date.now()) / 1000 / 60)) + ' minutes'
      }))
    });
  } catch (error) {
    console.error('getScheduledControls error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch schedules' });
  }
};

/**
 * DELETE /api/withdrawal/admin/control/schedule/:scheduleId
 * Cancel a scheduled control before it runs
 */
exports.cancelScheduledControl = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const schedule = await WithdrawalSchedule.findById(scheduleId);
    if (!schedule) return res.status(404).json({ success: false, message: 'Schedule not found' });

    if (schedule.executed) {
      return res.status(400).json({ success: false, message: 'Schedule has already been executed' });
    }

    schedule.cancelled = true;
    schedule.cancelledBy = req.user.id;
    await schedule.save();

    res.json({
      success: true,
      message: `Scheduled ${schedule.action} has been cancelled`,
      data: { id: schedule._id, action: schedule.action }
    });
  } catch (error) {
    console.error('cancelScheduledControl error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel schedule' });
  }
};

/**
 * POST /api/withdrawal/admin/control/run-schedules
 * Manually trigger the schedule executor (normally called by a cron job)
 * Can also be run on a cron via: node -e "require('./jobs/scheduleExecutor').run()"
 */
exports.executeScheduledControls = async (req, res) => {
  try {
    const due = await WithdrawalSchedule.find({
      executed: false,
      cancelled: false,
      scheduledFor: { $lte: new Date() }
    });

    if (due.length === 0) {
      return res.json({ success: true, message: 'No scheduled controls due', data: { executed: 0 } });
    }

    const results = [];

    for (const schedule of due) {
      try {
        switch (schedule.action) {
          case 'RESUME_ALL':
            await Promise.all([
              setConfig('global_paused', false, schedule.createdBy, schedule.reason),
              setConfig('global_pause_reason', null, schedule.createdBy, schedule.reason)
            ]);
            await auditLog('SCHEDULED_RESUME', schedule.createdBy, { reason: schedule.reason });
            break;
          case 'PAUSE_ALL':
            await Promise.all([
              setConfig('global_paused', true, schedule.createdBy, schedule.reason),
              setConfig('global_pause_reason', schedule.reason, schedule.createdBy, schedule.reason)
            ]);
            break;
          case 'ENABLE_BANK':
            await setConfig('bank_withdrawals_enabled', true, schedule.createdBy, schedule.reason);
            break;
          case 'DISABLE_BANK':
            await setConfig('bank_withdrawals_enabled', false, schedule.createdBy, schedule.reason);
            break;
          case 'ENABLE_CRYPTO':
            await setConfig('crypto_withdrawals_enabled', true, schedule.createdBy, schedule.reason);
            break;
          case 'DISABLE_CRYPTO':
            await setConfig('crypto_withdrawals_enabled', false, schedule.createdBy, schedule.reason);
            break;
        }

        schedule.executed = true;
        schedule.executedAt = new Date();
        await schedule.save();

        results.push({ id: schedule._id, action: schedule.action, status: 'executed' });
        console.log(`[SCHEDULER] Executed: ${schedule.action} (id: ${schedule._id})`);
      } catch (err) {
        console.error(`[SCHEDULER] Failed to execute ${schedule._id}:`, err.message);
        results.push({ id: schedule._id, action: schedule.action, status: 'failed', error: err.message });
      }
    }

    res.json({
      success: true,
      message: `Executed ${results.filter(r => r.status === 'executed').length} scheduled controls`,
      data: { executed: results.filter(r => r.status === 'executed').length, results }
    });
  } catch (error) {
    console.error('executeScheduledControls error:', error);
    res.status(500).json({ success: false, message: 'Failed to execute schedules' });
  }
};

// ─── ADMIN DASHBOARD SUMMARY ──────────────────────────────────────────────────

/**
 * GET /api/withdrawal/admin/control/dashboard
 * Single endpoint that returns everything an admin needs at a glance
 */
exports.getAdminDashboard = async (req, res) => {
  try {
    const [
      globalPaused,
      globalPauseReasoit
    ] = await Promise.all([
      getConfig('global_paused', false),
      getConfig('global_pause_reason', null),
      getConfig('emergency_freeze', false),
      getConfig('bank_withdrawals_enabled', true),
      getConfig('crypto_withdrawals_enabled', true),
      getConfig('global_min_limit', 20000),
      getConfig('global_max_limit', null)
    ]);

    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      pendingCount,
      processingCount,
      paidToday,
      failedToday,
      paidThisWeek,
      pendingAmountAgg,
      blacklistedCount,
      pausedUsersCount,
      pendingSchedules,
      recentAuditLogs,
      topPendingUsers
    ] = await Promise.all([
      Withdrawal.countDocuments({ status: 'pending' }),
      Withdrawal.countDocuments({ status: 'processing' }),
      Withdrawal.countDocuments({ status: 'paid', processedAt: { $gte: last24h } }),
      Withdrawal.countDocuments({ status: 'failed', updatedAt: { $gte: last24h } }),
      Withdrawal.countDocuments({ status: 'paid', processedAt: { $gte: last7d } }),
      Withdrawal.aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: null, total: { $sum: '$amount' }, bankTotal: { $sum: { $cond: [{ $eq: ['$withdrawalType', 'bank'] }, '$amount', 0] } }, cryptoTotal: { $sum: { $cond: [{ $eq: ['$withdrawalType', 'crypto'] }, '$amount', 0] } } } }
      ]),
      UserWithdrawalControl.countDocuments({ isBlacklisted: true }),
      UserWithdrawalControl.countDocuments({ isPaused: true, isBlacklisted: false }),
      WithdrawalSchedule.countDocuments({ executed: false, cancelled: false }),
      WithdrawalAuditLog.find().sort({ createdAt: -1 }).limit(5).populate('performedBy', 'name'),
      Withdrawal.aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: '$user', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
        { $unwind: { path: '$userInfo', preserveNullAndEmpty: true } }
      ])
    ]);

    const pendingAmounts = pendingAmountAgg[0] || { total: 0, bankTotal: 0, cryptoTotal: 0 };

    res.json({
      success: true,
      data: {
        systemStatus: {
          globalPaused,
          globalPauseReason,
          emergencyFreeze,
          bankEnabled,
          cryptoEnabled,
          overallHealthy: !globalPaused && !emergencyFreeze && bankEnabled && cryptoEnabled
        },
        limits: { globalMinLimit, globalMaxLimit },
        withdrawalMetrics: {
          pendingCount,
          processingCount,
          totalActiveCount: pendingCount + processingCount,
          totalActiveAmount: pendingAmounts.total,
          bankPendingAmount: pendingAmounts.bankTotal,
          cryptoPendingAmount: pendingAmounts.cryptoTotal,
          paidLast24h: paidToday,
          failedLast24h: failedToday,
          paidLast7d: paidThisWeek
        },
        userControls: {
          blacklistedUsers: blacklistedCount,
          pausedUsers: pausedUsersCount
        },
        scheduled: {
          pendingSchedules
        },
        recentAdminActivity: recentAuditLogs.map(l => ({
          action: l.action,
          performedBy: l.performedBy?.name || 'System',
          createdAt: l.createdAt
        })),
        topUsersWithPendingWithdrawals: topPendingUsers.map(u => ({
          userId: u._id,
          name: u.userInfo?.name || 'Unknown',
          email: u.userInfo?.email || 'Unknown',
          pendingCount: u.count,
          totalPendingAmount: u.totalAmount
        }))
      }
    });
  } catch (error) {
    console.error('getAdminDashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
  }
};

module.exports = exports;
