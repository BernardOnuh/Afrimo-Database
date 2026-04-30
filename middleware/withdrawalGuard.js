/**
 * WITHDRAWAL GUARD MIDDLEWARE
 * Enforces all admin withdrawal controls at the route level.
 * Apply this to any withdrawal processing route.
 *
 * Usage in routes:
 *   const { withdrawalGuard, cryptoGuard } = require('../middleware/withdrawalGuard');
 *   router.post('/instant', protect, withdrawalGuard, controller.processInstantWithdrawal);
 *   router.post('/crypto/request', protect, cryptoGuard, controller.processCryptoWithdrawal);
 */

const WithdrawalConfig = require('../models/WithdrawalConfig');
const UserWithdrawalControl = require('../models/UserWithdrawalControl');

async function getConfig(key, defaultValue = null) {
  const doc = await WithdrawalConfig.findOne({ key });
  return doc ? doc.value : defaultValue;
}

/**
 * Core guard — checks global + per-user controls
 */
async function withdrawalGuard(req, res, next) {
  try {
    const userId = req.user.id;

    // 1. Emergency freeze check (hardest block)
    const frozen = await getCoig('emergency_freeze', false);
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
          message: 'Your withdrawals are temporarily paused. Please contact support.'
        });
      }

      // 4. Per-user limit check
      const requestedAmount = req.body.amount || req.body.amountNGN;
      if (requestedAmount) {
        const effectiveMin = userControl.customMinLimit !== null
          ? userControl.customMinLimit
          : await getConfig('global_min_limit', 20000);

        const effectiveMax = userControl.customMaxLimit !== null
          ? userControl.customMaxLimit
          : await getConfig('global_max_limit', null);

        if (requestedAmount < effectiveMin) {
          return res.status(400).json({
            success: false,
            code: 'BELOW_MIN_LIMIT',
            message: `Minimum withdrawal amount is ₦${effectiveMin.toLocaleString()}`
          });
        }

        if (effectiveMax !==ull && requestedAmount > effectiveMax) {
          return res.status(400).json({
            success: false,
            code: 'ABOVE_MAX_LIMIT',
            message: `Maximum withdrawal amount is ₦${effectiveMax.toLocaleString()}`
          });
        }
      }
    } else {
      // No per-user record, still enforce global limits
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
            message:ximum withdrawal amount is ₦${globalMax.toLocaleString()}`
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error('withdrawalGuard error:', error);
    // Fail-safe: allow through if guard itself errors (avoid blocking real users due to DB issues)
    next();
  }
}

/**
 * Bank-specific guard (also checks bank channel toggle)
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
    console.error('bankWithdrawalGuard error:', error);
    next();
  }
}

/**
 * Crypto-specific guard (also checks crypto channel toggle)
 */
async function cryptoWithdrawalGuard(req, res, next) {
  try {
    cot cryptoEnabled = await getConfig('crypto_withdrawals_enabled', true);
    if (!cryptoEnabled) {
      return res.status(403).json({
        success: false,
        code: 'CRYPTO_DISABLED',
        message: 'Crypto withdrawals are currently disabled. Please try bank withdrawal or check back later.'
      });
    }
    return withdrawalGuard(req, res, next);
  } catch (error) {
    console.error('cryptoWithdrawalGuard error:', error);
    next();
  }
}

module.exports = { withdrawalGuard, bankWithdrawalGuard, cryptoWithdrawalGuard };
