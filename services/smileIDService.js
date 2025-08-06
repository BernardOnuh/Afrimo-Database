// services/smileIDService.js
const crypto = require("crypto");

class SmileIDService {
  constructor() {
    this.partnerId = process.env.SMILE_PARTNER_ID;
    this.apiKey = process.env.SMILE_API_KEY;
    this.environment = process.env.SMILE_ENVIRONMENT || "sandbox";
    this.baseUrl =
      this.environment === "production"
        ? "https://api.smileidentity.com/v1/smile_links"
        : "https://testapi.smileidentity.com/v1/smile_links";
    this.linkBaseUrl =
      this.environment === "production"
        ? "https://links.usesmileid.com"
        : "https://links.sandbox.usesmileid.com";
  }

  // Generate HMAC signature for authentication
  generateSignature(timestamp) {
    const hmac = crypto.createHmac("sha256", this.apiKey);
    hmac.update(timestamp);
    hmac.update(this.partnerId);
    hmac.update("sid_request");
    return hmac.digest("base64");
  }

  // Create a single-use verification link
  async createVerificationLink(config) {
    const timestamp = new Date().toISOString();
    const signature = this.generateSignature(timestamp);

    const requestBody = {
      partner_id: this.partnerId,
      signature: signature,
      timestamp: timestamp,
      name:
        config.name || `Verification Link - ${new Date().toLocaleDateString()}`,
      company_name:
        config.companyName || process.env.COMPANY_NAME || "Afrimobile",
      id_types: config.idTypes || [
        {
          country: "NG",
          id_type: "BVN",
          verification_method: "enhanced_kyc",
        },
        {
          country: "NG",
          id_type: "IDENTITY_CARD",
          verification_method: "doc_verification",
        },
      ],
      callback_url: config.callbackUrl || process.env.WEBHOOK_URL,
      data_privacy_policy_url:
        config.privacyPolicyUrl || process.env.PRIVACY_POLICY_URL,
      logo_url: config.logoUrl || process.env.COMPANY_LOGO_URL,
      is_single_use: true,
      user_id: config.userId || this.generateUserId(),
      partner_params: config.partnerParams || {},
      expires_at: config.expiresAt || this.getDefaultExpiry(),
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (response.ok) {
        const linkId =
          result.ref_id || result.linkId || result.id || result.smile_link_id;

        if (!linkId) {
          throw new Error("Link ID not found in API response");
        }

        const personalLink = `${this.linkBaseUrl}/${this.partnerId}/${linkId}`;

        return {
          success: true,
          linkId: linkId,
          personalLink: personalLink,
          userId: requestBody.user_id,
          expiresAt: requestBody.expires_at,
          fullResponse: result,
        };
      } else {
        throw new Error(
          `API Error: ${
            result.message || result.error || result.code || "Unknown error"
          }`
        );
      }
    } catch (error) {
      console.error("SmileID API Error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(
    receivedSignature,
    receivedTimestamp,
    partnerId,
    apiKey
  ) {
    const hmac = crypto.createHmac("sha256", apiKey || this.apiKey);
    hmac.update(receivedTimestamp);
    hmac.update(partnerId || this.partnerId);
    hmac.update("sid_request");
    const generatedSignature = hmac.digest("base64");

    return generatedSignature === receivedSignature;
  }

  // Generate unique user ID
  generateUserId() {
    return "user_" + crypto.randomUUID();
  }

  // Get default expiry (24 hours from now)
  getDefaultExpiry() {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);
    return expiry.toISOString();
  }

  // Get link information
  async getLinkInfo(linkId) {
    const timestamp = new Date().toISOString();
    const signature = this.generateSignature(timestamp);

    const params = new URLSearchParams({
      partner_id: this.partnerId,
      signature: signature,
      timestamp: timestamp,
    });

    try {
      const response = await fetch(`${this.baseUrl}/${linkId}?${params}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      return response.ok ? result : { error: result.message };
    } catch (error) {
      console.error("SmileID Get Link Error:", error);
      return { error: error.message };
    }
  }

  // Update an existing link
  async updateLink(linkId, updates) {
    const timestamp = new Date().toISOString();
    const signature = this.generateSignature(timestamp);

    const requestBody = {
      partner_id: this.partnerId,
      signature: signature,
      timestamp: timestamp,
      ...updates,
    };

    try {
      const response = await fetch(`${this.baseUrl}/${linkId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();
      return response.ok ? result : { error: result.message };
    } catch (error) {
      console.error("SmileID Update Link Error:", error);
      return { error: error.message };
    }
  }
}

module.exports = SmileIDService;