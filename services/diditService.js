// services/diditService.js - Didit KYC integration
const crypto = require('crypto');

// Workflow ID is per-session config, NOT a secret. Chosen from the Didit console (Workflows).
const DIDIT_WORKFLOW_ID = '48c55b4b-ba25-470a-b29e-820e28bf8ecb'; // "Free KYC"

const DIDIT_BASE_URL = 'https://verification.didit.me/v3';

class DiditService {
  constructor() {
    this.apiKey = process.env.DIDIT_API_KEY;
    this.webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;

    if (!this.apiKey) {
      console.warn('⚠️ DIDIT_API_KEY not set - Didit KYC features will be disabled');
      this.disabled = true;
    } else {
      console.log('Didit KYC Service initialized');
    }
  }

  get workflowId() {
    return DIDIT_WORKFLOW_ID;
  }

  // Create a verification session server-side. x-api-key never leaves the backend.
  async createSession({ vendorData, expectedDetails, metadata, language, callback }) {
    if (this.disabled) {
      throw new Error('Didit KYC is not configured (DIDIT_API_KEY missing)');
    }

    const body = {
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: vendorData,
    };

    if (expectedDetails) body.expected_details = expectedDetails;
    if (metadata) body.metadata = metadata;
    if (language) body.language = language;
    if (callback) body.callback = callback;

    const response = await fetch(`${DIDIT_BASE_URL}/session/`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // 403 => missing / invalid / revoked x-api-key. Body: {"detail":"You do not have permission..."}
      const detail = await response.text();
      throw new Error(`Didit session create failed (${response.status}): ${detail}`);
    }

    const session = await response.json();
    // { session_id, session_token, url, status, workflow_id, vendor_data }
    return {
      sessionId: session.session_id,
      sessionToken: session.session_token,
      url: session.url,
      status: session.status,
      workflowId: session.workflow_id,
      vendorData: session.vendor_data,
      fullResponse: session,
    };
  }

  // Retrieve the full decision JSON for a session (module arrays keyed by node_id).
  async getSessionDecision(sessionId) {
    if (this.disabled) {
      throw new Error('Didit KYC is not configured (DIDIT_API_KEY missing)');
    }

    const response = await fetch(`${DIDIT_BASE_URL}/session/${sessionId}/decision/`, {
      method: 'GET',
      headers: { 'x-api-key': this.apiKey },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Didit decision fetch failed (${response.status}): ${detail}`);
    }

    return response.json();
  }

  // Get session info by sessionId (status lookup).
  async getSession(sessionId) {
    const response = await fetch(`${DIDIT_BASE_URL}/session/${sessionId}/`, {
      method: 'GET',
      headers: { 'x-api-key': this.apiKey },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Didit session fetch failed (${response.status}): ${detail}`);
    }
    return response.json();
  }

  // ── Webhook signature verification (X-Signature-V2) ──────────────────────────

  // Whole-number floats (1.0) -> integers (1), recursively. Matches Didit's
  // server canonicalisation.
  static shortenFloats(v) {
    if (Array.isArray(v)) return v.map(DiditService.shortenFloats);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, DiditService.shortenFloats(x)])
      );
    }
    if (typeof v === 'number' && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
    return v;
  }

  // Recursive lexicographic key sort (array order preserved).
  static sortKeys(v) {
    if (Array.isArray(v)) return v.map(DiditService.sortKeys);
    if (v && typeof v === 'object') {
      return Object.keys(v)
        .sort()
        .reduce((acc, k) => {
          acc[k] = DiditService.sortKeys(v[k]);
          return acc;
        }, {});
    }
    return v;
  }

  // Canonicalise a parsed webhook body as JSON.stringify(sortKeys(shortenFloats(body)))
  // with unescaped Unicode (the JS default), then return its HMAC-SHA256 digest.
  static canonicalHmac(body, secret) {
    const canonical = JSON.stringify(DiditService.sortKeys(DiditService.shortenFloats(body)));
    return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  }

  // Verify the X-Signature-V2 header with constant-time compare.
  verifyWebhook(parsedBody, signature, secret) {
    const secretToUse = secret || this.webhookSecret;
    if (!secretToUse) {
      throw new Error('DIDIT_WEBHOOK_SECRET is not configured');
    }
    const expected = DiditService.canonicalHmac(parsedBody, secretToUse);
    if (signature.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (err) {
      return false;
    }
  }

  // X-Signature fallback: HMAC over the exact raw bytes Didit transmitted
  // (only valid when no middleware re-encoded the body).
  verifyRawSignature(rawBuffer, signature, secret) {
    const secretToUse = secret || this.webhookSecret;
    if (!secretToUse) throw new Error('DIDIT_WEBHOOK_SECRET is not configured');
    const expected = crypto.createHmac('sha256', secretToUse).update(rawBuffer).digest('hex');
    if (signature.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (err) {
      return false;
    }
  }

  // X-Signature-Simple fallback: "{timestamp}:{session_id}:{status}:{webhook_type}".
  // Authenticates the envelope only - decision data should be re-fetched if used.
  verifySimpleSignature(parsedBody, signature, secret) {
    const secretToUse = secret || this.webhookSecret;
    if (!secretToUse) throw new Error('DIDIT_WEBHOOK_SECRET is not configured');
    const canonical = [
      parsedBody.timestamp ?? '',
      parsedBody.session_id ?? '',
      parsedBody.status ?? '',
      parsedBody.webhook_type ?? '',
    ].join(':');
    const expected = crypto.createHmac('sha256', secretToUse).update(canonical).digest('hex');
    if (signature.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (err) {
      return false;
    }
  }
}

module.exports = { DiditService, DIDIT_WORKFLOW_ID };