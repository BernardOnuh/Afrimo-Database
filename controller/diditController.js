// controller/diditController.js - Didit KYC controllers
const mongoose = require('mongoose');
const User = require('../models/User');
const KycVerification = require('../models/KycVerification');
const UserShare = require('../models/UserShare');
const UserShareV2 = require('../models/UserShareV2');
const { DiditService } = require('../services/diditService');

const didit = new DiditService();

// Map Didit status string -> app kycStatus convention
function mapStatus(diditStatus) {
  switch (diditStatus) {
    case 'Approved':
      return 'verified';
    case 'Declined':
    case 'Abandoned':
    case 'Expired':
      return 'failed';
    case 'Kyc Expired':
      return 'verified';
    default:
      return 'pending';
  }
}

// Determine whether a user actually owns shares (regular or co-founder).
// Checks the maintained ownership snapshots (UserShareV2 and legacy
// UserShare) plus the user's stats counter, so legitimate shareholders are
// never wrongly blocked even if one source is stale.
async function userHasShares(user) {
  try {
    if (Number(user.stats && user.stats.totalShares) > 0) return true;

    const userId = user._id;
    const [v2, legacy] = await Promise.all([
      UserShareV2.findOne({ user: userId })
        .select('totalOwnershipPct cofounderOwnershipPct regularOwnershipPct')
        .lean(),
      UserShare.findOne({ user: userId })
        .select('totalOwnershipPct transactions')
        .lean(),
    ]);

    if (v2 && (v2.totalOwnershipPct > 0 || v2.regularOwnershipPct > 0 || v2.cofounderOwnershipPct > 0)) {
      return true;
    }

    if (legacy && legacy.totalOwnershipPct > 0) return true;

    if (legacy && Array.isArray(legacy.transactions)) {
      return legacy.transactions.some(
        (t) => t.status === 'completed' && (Number(t.shares) > 0 || Number(t.ownershipPct) > 0)
      );
    }

    return false;
  } catch (error) {
    // Never fail the request because of an ownership lookup; fall back to the
    // user's stats counter.
    console.error('⚠️ userHasShares lookup error:', error.message);
    return Number(user.stats && user.stats.totalShares) > 0;
  }
}

// Top-level KYC info shape used across responses
async function kycSummary(user, latestRecord) {
  const hasShares = await userHasShares(user);
  return {
    kycStatus: user.kycStatus || 'not_started',
    isVerified: !!user.isVerified,
    provider: user.kycData && user.kycData.provider ? user.kycData.provider : null,
    verifiedAt: user.kycData && user.kycData.verifiedAt ? user.kycData.verifiedAt : null,
    diditStatus: latestRecord ? latestRecord.status : (user.kycData && user.kycData.diditStatus) || null,
    diditSessionId: latestRecord ? latestRecord.diditSessionId : null,
    hasShares,
  };
}

// POST /api/kyc/session - create a Didit verification session for the logged-in user
const createSession = async (req, res) => {
  try {
    if (didit.disabled) {
      return res.status(503).json({
        success: false,
        message: 'KYC service not configured. Please try again later.',
      });
    }

    const user = req.user;

    // Users must own at least one share before they can complete KYC.
    // This gate's the KYC + co-founder onboarding so only shareholders
    // (investors) can verify. Buyers without shares are pointed to buy-shares.
    const hasShares = await userHasShares(user);

    if (!hasShares) {
      return res.status(403).json({
        success: false,
        message: 'You need to own at least one share before you can complete KYC verification. Buy shares first to unlock KYC and the co-founder space.',
        code: 'SHARES_REQUIRED',
      });
    }

    // If user is already verified, don't spin up another session
    if (user.kycStatus === 'verified' && user.isVerified) {
      return res.status(200).json({
        success: true,
        message: 'Account already verified',
        data: {
          verified: true,
          url: null,
        },
      });
    }

    // Identify the user to Didit with a stable internal id (never trust the client blindly)
    const vendorData = String(user._id);

    let expectedDetails;
    if (user.name) {
      const nameParts = String(user.name).trim().split(/\s+/);
      expectedDetails = {
        first_name: nameParts[0] || undefined,
        last_name: nameParts.slice(1).join(' ') || undefined,
      };
    }

    const callback = `${process.env.FRONTEND_URL || 'https://www.afrimobiletech.com'}/dashboard/kyc`;

    const session = await didit.createSession({
      vendorData,
      expectedDetails,
      metadata: { afrimobileUserId: String(user._id) },
      language: 'en',
      callback,
    });

    // Persist a record linking the Didit session to the user
    const record = await KycVerification.findOneAndUpdate(
      { diditSessionId: session.sessionId },
      {
        user: user._id,
        diditSessionId: session.sessionId,
        workflowId: session.workflowId,
        status: session.status || 'Not Started',
        sessionUrl: session.url,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    user.kycStatus = user.kycStatus === 'verified' ? user.kycStatus : 'pending';
    user.kycData = {
      ...(user.kycData || {}),
      provider: 'didit',
      diditSessionId: session.sessionId,
      lastStartedAt: new Date(),
      diditStatus: session.status || 'Not Started',
    };
    await user.save({ validateModifiedOnly: true });

    return res.status(201).json({
      success: true,
      message: 'KYC verification session created',
      data: {
        url: session.url,
        session_id: session.sessionId,
        verified: false,
      },
    });
  } catch (error) {
    console.error('❌ Error creating Didit session:', error);
    return res.status(502).json({
      success: false,
      message: 'Failed to create verification session',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// GET /api/kyc/status - current KYC state for the logged-in user
const getStatus = async (req, res) => {
  try {
    const user = req.user;
    const latestRecord = await KycVerification.findOne({ user: user._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: 'KYC status retrieved',
      data: await kycSummary(user, latestRecord),
    });
  } catch (error) {
    console.error('❌ Error fetching KYC status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch KYC status',
    });
  }
};

// POST /api/webhooks/didit - receive Didit status/data webhooks
// Signature + freshness + idempotency verification happen here.
const handleWebhook = async (req, res) => {
  // 1. Extract raw payload
  let parsed;
  try {
    const raw = req.body;
    if (Buffer.isBuffer(raw)) {
      parsed = JSON.parse(raw.toString('utf8'));
    } else if (typeof raw === 'string') {
      parsed = JSON.parse(raw);
    } else {
      parsed = raw;
    }
  } catch (error) {
    console.error('❌ Didit webhook: unparseable body:', error.message);
    return res.status(400).send('bad json');
  }

  const ts = Number(req.headers['x-timestamp']);

  // 2. Freshness — reject anything older/newer than 300s (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (!ts || Math.abs(now - ts) > 300) {
    return res.status(401).send('stale');
  }

  // 3. Authenticate with X-Signature-V2 (preferred), falling back to the raw
  //    X-Signature bytes, then X-Signature-Simple (envelope only). All constant-time.
  try {
    const v2 = req.headers['x-signature-v2'];
    const raw = req.headers['x-signature'];
    const simple = req.headers['x-signature-simple'];

    let ok =
      (v2 && didit.verifyWebhook(parsed, v2)) ||
      (raw && Buffer.isBuffer(req.body) && didit.verifyRawSignature(req.body, raw)) ||
      (simple && didit.verifySimpleSignature(parsed, simple));

    if (!ok) {
      console.warn('❌ Didit webhook: invalid signature (v2=%s raw=%s simple=%s)', !!v2, !!raw, !!simple);
      return res.status(401).send('bad sig');
    }
  } catch (error) {
    console.error('❌ Didit webhook: signature verification unavailable:', error.message);
    return res.status(500).send('sig verify unavailable');
  }

  // 3b. Dispatch by webhook_type. Only session events update the user record;
  //     entity/transaction/travel-rule events are acknowledged (logged) for now.
  const webhookType = parsed.webhook_type || parsed.event_type;
  if (webhookType && webhookType !== 'status.updated' && webhookType !== 'data.updated') {
    console.log(`ℹ️ Didit webhook: acknowledged ${webhookType} (${parsed.status}) - no KYC action`);
    return res.status(200).send('ok');
  }

  // 4. Idempotency — dedupe on event_id (reused across destinations and retries)
  const eventId = parsed.event_id;
  if (eventId) {
    const existing = await KycVerification.findOne({ lastEventId: eventId });
    if (existing) {
      return res.status(200).send('ok');
    }
  }

  const { session_id, status, vendor_data } = parsed;

  // 5. Apply the decision. Status strings are case-sensitive literals.
  try {
    await applyDecision({ sessionId: session_id, status, vendorData: vendor_data, parsed, eventId });
  } catch (error) {
    console.error('❌ Didit webhook: applyDecision error:', error);
    return res.status(500).send('processing error');
  }

  // 6. Return 2xx within 5 seconds.
  return res.status(200).send('ok');
};

// Update the KycVerification record + the User's KYC fields from a webhook event.
async function applyDecision({ sessionId, status, vendorData, parsed, eventId }) {
  const isValidId = (v) => mongoose.Types.ObjectId.isValid(v);

  // Resolve the user either from the KycVerification record or from vendor_data.
  let record = sessionId ? await KycVerification.findOne({ diditSessionId: sessionId }) : null;

  let user = null;
  if (record && isValidId(record.user)) {
    user = await User.findById(record.user);
  } else if (parsed.metadata && isValidId(parsed.metadata.afrimobileUserId)) {
    user = await User.findById(parsed.metadata.afrimobileUserId);
  } else if (vendorData && isValidId(vendorData)) {
    user = await User.findById(vendorData);
  }

  if (!record && !user) {
    console.warn('⚠️ Didit webhook: unknown user/session (ignored). session:', sessionId, 'vendor:', vendorData);
    return;
  }

  if (record) {
    const update = { status, lastEventId: eventId || record.lastEventId };
    if (status === 'Approved') update.decision = parsed.decision || null;
    await KycVerification.findByIdAndUpdate(record._id, update, { new: true });
  } else if (user) {
    // Session wasn't persisted server-side (e.g. webhook arrived standalone) - carry it.
    record = await KycVerification.create({
      user: user._id,
      diditSessionId: sessionId || 'unknown',
      workflowId: parsed.workflow_id || null,
      status,
      lastEventId: eventId,
      sessionUrl: null,
      decision: parsed.decision || null,
    });
  }

  if (!user) return;

  user.kycStatus = mapStatus(status);
  user.kycData = {
    ...(user.kycData || {}),
    provider: 'didit',
    diditSessionId: sessionId || (user.kycData && user.kycData.diditSessionId) || null,
    diditStatus: status,
  };

  if (status === 'Approved') {
    user.isVerified = true;
    user.verified = true;
    user.kycData.verifiedAt = new Date();
    user.kycData.decisionAt = new Date();
    if (parsed.decision) {
      user.kycData.idVerifications = parsed.decision.id_verifications || undefined;
      user.kycData.livenessChecks = parsed.decision.liveness_checks || undefined;
      user.kycData.faceMatches = parsed.decision.face_matches || undefined;
      user.kycData.amlScreenings = parsed.decision.aml_screenings || undefined;
    }
  } else if (status === 'Declined') {
    user.isVerified = false;
    user.verified = false;
    user.kycData.failedAt = new Date();
    user.kycData.failedReason = 'Didit declined the verification';
  } else if (status === 'Kyc Expired') {
    user.isVerified = false;
    user.verified = false;
    user.kycStatus = 'verified';
    user.kycData.kycExpiredAt = new Date();
    user.kycData.nextSessionRequired = true;
  } else if (status === 'Abandoned') {
    user.isVerified = false;
    user.kycStatus = 'failed';
  } else if (status === 'In Review') {
    user.kycStatus = 'pending';
  }

  await user.save({ validateModifiedOnly: true });
}

module.exports = {
  createSession,
  getStatus,
  handleWebhook,
};