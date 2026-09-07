// controller/diditController.js - Didit KYC controllers
const User = require('../models/User');
const KycVerification = require('../models/KycVerification');
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

// Top-level KYC info shape used across responses
function kycSummary(user, latestRecord) {
  return {
    kycStatus: user.kycStatus || 'not_started',
    isVerified: !!user.isVerified,
    provider: user.kycData && user.kycData.provider ? user.kycData.provider : null,
    verifiedAt: user.kycData && user.kycData.verifiedAt ? user.kycData.verifiedAt : null,
    diditStatus: latestRecord ? latestRecord.status : (user.kycData && user.kycData.diditStatus) || null,
    diditSessionId: latestRecord ? latestRecord.diditSessionId : null,
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
    await user.save();

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
      data: kycSummary(user, latestRecord),
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

  const signature = req.headers['x-signature-v2'] || '';
  const ts = Number(req.headers['x-timestamp']);

  // 2. Freshness — reject anything older/newer than 300s (replay protection)
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
    return res.status(401).send('stale');
  }

  // 3. Constant-time HMAC-SHA256 compare against X-Signature-V2
  let valid;
  try {
    valid = didit.verifyWebhook(parsed, signature);
  } catch (error) {
    console.error('❌ Didit webhook: signature verification unavailable:', error.message);
    return res.status(500).send('sig verify unavailable');
  }
  if (!valid) {
    console.warn('❌ Didit webhook: invalid signature');
    return res.status(401).send('bad sig');
  }

  // 4. Idempotency — dedupe on event_id (unique per delivery attempt)
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
  // Resolve the user either from the KycVerification record or from vendor_data.
  let record = sessionId ? await KycVerification.findOne({ diditSessionId: sessionId }) : null;

  let user = null;
  if (record) {
    user = await User.findById(record.user);
  } else if (parsed.metadata && parsed.metadata.afrimobileUserId) {
    user = await User.findById(parsed.metadata.afrimobileUserId);
  } else if (vendorData) {
    user = await User.findById(vendorData);
  }

  if (!user && !record) {
    console.warn('⚠️ Didit webhook: unknown user for session', sessionId, vendorData);
    return;
  }

  const update = {
    status,
    lastEventId: eventId || record && record.lastEventId,
  };

  if (status === 'Approved') {
    update.decision = parsed.decision || null;
  }

  if (record) {
    await KycVerification.findByIdAndUpdate(record._id, update, { new: true });
  } else if (sessionId) {
    record = await KycVerification.create({
      user: user ? user._id : undefined,
      diditSessionId: sessionId,
      workflowId: parsed.workflow_id || null,
      status,
      decision: parsed.decision || null,
      lastEventId: eventId,
    });
  }

  if (user) {
    // Persist event_id dedupe even if we couldn't resolve a user record for some reason
    if (!record && eventId) {
      record = await KycVerification.create({
        diditSessionId: sessionId || 'unknown',
        status,
        lastEventId: eventId,
        decision: parsed.decision || null,
        workflowId: parsed.workflow_id || null,
      });
    }

    user.kycStatus = mapStatus(status);
    user.kycData = {
      ...(user.kycData || {}),
      provider: 'didit',
      diditSessionId: sessionId || user.kycData.diditSessionId,
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

    await user.save();
  }
}

module.exports = {
  createSession,
  getStatus,
  handleWebhook,
};