/**
 * WITHDRAWAL GUARD MIDDLEWARE
 * Enforces all admin withdrawal controls at the route level.
 * Apply this to any withdrawal processing route.
 *
 * Usage in routes:
 *   const { bankWithdrawalGuard, cryptoWithdrawalGuard, withdrawalAdminGuard } = require('../middleware/withdrawalGuard');
 *   router.post('/instant',        protect, bankWithdrawalGuard,   controller.processInstantWithdrawal);
 *   router.post('/crypto/request', protect, cryptoWithdrawalGuard, controller.processCryptoWithdrawal);
 *   router.put('/admin/:id/approve', protect, adminProtect, withdrawalAdminGuard, controller.approveWithdrawal);
 *   router.put('/admin/:id/pay',     protect, adminProtect, withdrawalAdminGuard, controller.markWithdrawalAsPaid);
 */

const WithdrawalConfig = require('../models/WithdrawalConfig');
const UserWithdrawalControl = require('../models/UserWithdrawalControl');

async function getConfig(key, defaultValue = null) {
  const doc = await WithdrawalConfig.findOne({ key });
  return doc ? doc.value : defaultValue;
}

/**
 * Core guard — checks global freeze/pause + per-user controls + limits.
 * Fail-CLOSED: if the guard itself throws, the withdrawal is BLOCKED (not allowed through).
 */
async function withdrawalGuard(req, res, next) {
  try {
    const userId = req.user.id;

    // 1. Emergency freeze check (hardest block)
    // BUG FIX: was `getCoig` (typo) — corrected to `getConfig`
    const frozen = await getConfig('emergency_freeze', false);
    if (frozen) {
      const reason = await getConfig('emergency_freeze_reason', 'Emergency maintenance in progress');
      return res.status(503).json({
        success: false,
        code: 'EMERGENCY_FREEZE',
        message: `Withdrawals are temporarily unavailable: ${reason}`
      });
    }

    // 2. Global pause check
    const paused = await getConfig('global_paused', false);
    if (paused) {
      const reason = await getConfig('global_pause_reason', 'Withdrawals are currently paused');
      return res.status(403).json({
        success: false,
        code: 'GLOBAL_PAUSE',
        message: reason
      });
    }

    // 3. Per-user control check
    const userControl = await UserWithdrawalControl.findOne({ user: userId });
    if (userControl) {
      if (userControl.isBlacklisted) {
        return res.status(403).json({
          success: false,
          code: 'USER_BLACKLISTED',
          message: 'Your account has been restricted from making withdrawals. Please contact support.'
        });
      }
      if (userControl.isPaused) {
        return res.status(403).json({
          success: false,
          code: 'USER_PAUSED',
          message: userControl.pauseReason || 'Your withdrawals are temporarily paused. Please contact support.'
        });
      }

      // 4. Per-user limit check
      const requestedAmount = req.body.amount || req.body.amountNGN;
      if (requestedAmount) {
        const effectiveMin = userControl.customMinLimit !== null && userControl.customMinLimit !== undefined
          ? userControl.customMinLimit
          : await getConfig('global_min_limit', 20000);

        const effectiveMax = userControl.customMaxLimit !== null && userControl.customMaxLimit !== undefined
          ? userControl.customMaxLimit
          : await getConfig('global_max_limit', null);

        if (requestedAmount < effectiveMin) {
          return res.status(400).json({
            success: false,
            code: 'BELOW_MIN_LIMIT',
            message: `Minimum withdrawal amount is ₦${effectiveMin.toLocaleString()}`
          });
        }

        // BUG FIX: was `!==ull` (missing `n`) — corrected to `!== null`
        if (effectiveMax !== null && requestedAmount > effectiveMax) {
          return res.status(400).json({
            success: false,
            code: 'ABOVE_MAX_LIMIT',
            message: `Maximum withdrawal amount is ₦${effectiveMax.toLocaleString()}`
          });
        }
      }
    } else {
      // No per-user record — still enforce global limits
      const requestedAmount = req.body.amount || req.body.amountNGN;
      if (requestedAmount) {
        const globalMin = await getConfig('global_min_limit', 20000);
        const globalMax = await getConfig('global_max_limit', null);

        if (requestedAmount < globalMin) {
          return res.status(400).json({
            success: false,
            code: 'BELOW_MIN_LIMIT',
            message: `Minimum withdrawal amount is ₦${globalMin.toLocaleString()}`
          });
        }

        if (globalMax !== null && requestedAmount > globalMax) {
          return res.status(400).json({
            success: false,
            code: 'ABOVE_MAX_LIMIT',
            message: `Maximum withdrawal amount is ₦${globalMax.toLocaleString()}`
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error('[withdrawalGuard] error:', error);
    // Fail-CLOSED: block the withdrawal if the guard itself crashes.
    // This prevents a DB outage from silently bypassing all controls.
    return res.status(500).json({
      success: false,
      code: 'GUARD_ERROR',
      message: 'Unable to verify withdrawal system status. Please try again shortly.'
    });
  }
}

/**
 * Bank-specific guard — checks bank channel toggle, then runs core guard.
 */
async function bankWithdrawalGuard(req, res, next) {
  try {
    const bankEnabled = await getConfig('bank_withdrawals_enabled', true);
    if (!bankEnabled) {
      return res.status(403).json({
        success: false,
        code: 'BANK_DISABLED',
        message: 'Bank withdrawals are currently disabled. Please try crypto withdrawal or check back later.'
      });
    }
    return withdrawalGuard(req, res, next);
  } catch (error) {
    console.error('[bankWithdrawalGuard] error:', error);
    return res.status(500).json({
      success: false,
      code: 'GUARD_ERROR',
      message: 'Unable to verify withdrawal system status. Please try again shortly.'
    });
  }
}

/**
 * Crypto-specific guard — checks crypto channel toggle, then runs core guard.
 */
async function cryptoWithdrawalGuard(req, res, next) {
  try {
    const cryptoEnabled = await getConfig('crypto_withdrawals_enabled', true);
    if (!cryptoEnabled) {
      return res.status(403).json({
        success: false,
        code: 'CRYPTO_DISABLED',
        message: 'Crypto withdrawals are currently disabled. Please try bank withdrawal or check back later.'
      });
    }
    return withdrawalGuard(req, res, next);
  } catch (error) {
    console.error('[cryptoWithdrawalGuard] error:', error);
    return res.status(500).json({
      success: false,
      code: 'GUARD_ERROR',
      message: 'Unable to verify withdrawal system status. Please try again shortly.'
    });
  }
}

/**
 * Admin approval/payout guard — prevents admins from pushing money out
 * while the system is frozen or globally paused.
 * Does NOT check per-user blacklist/pause (admins may need to force-resolve).
 */
async function withdrawalAdminGuard(req, res, next) {
  try {
    const frozen = await getConfig('emergency_freeze', false);
    if (frozen) {
      const reason = await getConfig('emergency_freeze_reason', 'Emergency maintenance in progress');
      return res.status(503).json({
        success: false,
        code: 'EMERGENCY_FREEZE',
        message: `Withdrawal system is frozen: ${reason}. Lift the freeze before approving payouts.`
      });
    }

    const paused = await getConfig('global_paused', false);
    if (paused) {
      const reason = await getConfig('global_pause_reason', 'Withdrawals are currently paused');
      return res.status(403).json({
        success: false,
        code: 'GLOBAL_PAUSE',
        message: `${reason}. Resume the system before approving payouts.`
      });
    }

    next();
  } catch (error) {
    console.error('[withdrawalAdminGuard] error:', error);
    return res.status(500).json({
      success: false,
      code: 'GUARD_ERROR',
      message: 'Unable to verify withdrawal system status.'
    });
  }
}

module.exports = { withdrawalGuard, bankWithdrawalGuard, cryptoWithdrawalGuard, withdrawalAdminGuard }; 