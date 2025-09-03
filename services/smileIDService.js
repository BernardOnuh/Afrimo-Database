// services/smileIDService.js - FIXED VERSION with 89-day expiry
const crypto = require("crypto");

class SmileIDService {
  constructor() {
    // Validate required environment variables
    this.partnerId = process.env.SMILE_PARTNER_ID;
    this.apiKey = process.env.SMILE_API_KEY;
    this.environment = process.env.SMILE_ENVIRONMENT || "sandbox";
    
    if (!this.partnerId) {
      throw new Error("SMILE_PARTNER_ID environment variable is required");
    }
    
    if (!this.apiKey) {
      throw new Error("SMILE_API_KEY environment variable is required");
    }
    
    this.baseUrl =
      this.environment === "production"
        ? "https://api.smileidentity.com/v1/smile_links"
        : "https://testapi.smileidentity.com/v1/smile_links";
    this.linkBaseUrl =
      this.environment === "production"
        ? "https://links.usesmileid.com"
        : "https://links.sandbox.usesmileid.com";
        
    console.log(`SmileID Service initialized in ${this.environment} mode`);
  }

  // FIXED: Changed default to 60 days with better expiry calculation
  getDefaultExpiry(daysFromNow = 60) {
    const expiry = new Date();
    
    // Add days instead of hours for longer validity
    expiry.setDate(expiry.getDate() + daysFromNow);
    
    // Set to end of day to avoid timezone issues
    expiry.setHours(23, 59, 59, 999);
    
    // Return UTC timestamp
    return expiry.toISOString();
  }

  // FIXED: Always calculate expiry as current date + 60 days
  calculateExpiry(expiryConfig) {
    // Always use 60 days from current date, ignore any provided configuration
    return this.getDefaultExpiry(60);
  }

  // Generate HMAC signature for authentication
  generateSignature(timestamp) {
    if (!this.apiKey) {
      throw new Error("API key is not configured");
    }
    
    const hmac = crypto.createHmac("sha256", this.apiKey);
    hmac.update(timestamp);
    hmac.update(this.partnerId);
    hmac.update("sid_request");
    return hmac.digest("base64");
  }

  // FIXED: Create a single-use verification link with 89-day default expiry
  async createVerificationLink(config) {
    const timestamp = new Date().toISOString();
    const signature = this.generateSignature(timestamp);

    // FIXED: Better expiry calculation with 89-day default
    const calculatedExpiry = this.calculateExpiry(config.expiresAt);
    
    console.log(`Creating link with expiry: ${calculatedExpiry} (60 days from now)`);

    const requestBody = {
      partner_id: this.partnerId,
      signature: signature,
      timestamp: timestamp,
      name: config.name || `Verification Link - ${new Date().toLocaleDateString()}`,
      company_name: config.companyName || process.env.COMPANY_NAME || "Afrimobile",
      id_types: config.idTypes || [
        {
          country: "NG",
          id_type: "NIN",
          verification_method: "enhanced_kyc",
        },
      ],
      callback_url: config.callbackUrl || process.env.WEBHOOK_URL,
      data_privacy_policy_url: config.privacyPolicyUrl || process.env.PRIVACY_POLICY_URL,
      logo_url: config.logoUrl || process.env.COMPANY_LOGO_URL,
      is_single_use: true,
      user_id: config.userId || this.generateUserId(),
      partner_params: config.partnerParams || {},
      expires_at: calculatedExpiry, // FIXED: Always current date + 60 days
    };

    try {
      console.log('Creating SmileID link with config:', {
        partner_id: this.partnerId,
        user_id: requestBody.user_id,
        expires_at: requestBody.expires_at,
        id_types: requestBody.id_types,
        environment: this.environment
      });

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();
      console.log('SmileID API Response:', result);

      if (response.ok) {
        const linkId = result.ref_id || result.linkId || result.id || result.smile_link_id;

        if (!linkId) {
          throw new Error("Link ID not found in API response");
        }

        const personalLink = `${this.linkBaseUrl}/${this.partnerId}/${linkId}`;

        // FIXED: Return the expiry we actually sent to the API (60 days from now)
        return {
          success: true,
          linkId: linkId,
          personalLink: personalLink,
          userId: requestBody.user_id,
          expiresAt: requestBody.expires_at, // Use our calculated expiry (60 days from now)
          requestedExpiry: calculatedExpiry,
          fullResponse: result,
        };
      } else {
        throw new Error(
          `API Error: ${result.message || result.error || result.code || "Unknown error"}`
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

  // FIXED: Enhanced link info method with expiry status calculation
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
      
      if (response.ok) {
        // FIXED: Add expiry status calculation
        const now = new Date();
        const expiryDate = new Date(result.expires_at);
        const isExpired = now > expiryDate;
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

        return {
          ...result,
          isExpired,
          daysUntilExpiry: isExpired ? 0 : daysUntilExpiry,
          expiryStatus: isExpired ? 'expired' : 'active'
        };
      } else {
        return { error: result.message };
      }
    } catch (error) {
      console.error("SmileID Get Link Error:", error);
      return { error: error.message };
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(receivedSignature, receivedTimestamp, partnerId, apiKey) {
    const keyToUse = apiKey || this.apiKey;
    const partnerIdToUse = partnerId || this.partnerId;
    
    if (!keyToUse) {
      throw new Error("API key is required for signature verification");
    }
    
    if (!partnerIdToUse) {
      throw new Error("Partner ID is required for signature verification");
    }
    
    const hmac = crypto.createHmac("sha256", keyToUse);
    hmac.update(receivedTimestamp);
    hmac.update(partnerIdToUse);
    hmac.update("sid_request");
    const generatedSignature = hmac.digest("base64");

    return generatedSignature === receivedSignature;
  }

  // Generate unique user ID
  generateUserId() {
    return "user_" + crypto.randomUUID();
  }

  // Update existing link
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

  // Validate environment variables
  static validateEnvironment() {
    const required = ['SMILE_PARTNER_ID', 'SMILE_API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
}

module.exports = SmileIDService;