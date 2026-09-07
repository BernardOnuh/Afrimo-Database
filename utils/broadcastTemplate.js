// utils/broadcastTemplate.js - Shared email template for the KYC + shares broadcast.
const SITE_URL = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
const KYC_URL = `${SITE_URL}/dashboard/kyc`;
const BUY_SHARES_URL = `${SITE_URL}/dashboard/buy-shares`;

const SUBJECT = 'KYC verification is now available';

function buildHtml(firstName) {
  const name = firstName || 'there';
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
    <div style="background: #111827; padding: 20px 32px; border-radius: 12px 12px 0 0;">
      <span style="color: #ffffff; font-size: 20px; font-weight: bold;">AfriMobile</span>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 32px;">
      <p style="font-size: 16px; margin: 0 0 16px;">Hello ${name},</p>
      <p style="font-size: 15px; margin: 0 0 20px;">
        KYC verification is now available on AfriMobile. Verify your identity to unlock:
      </p>

      <div style="border: 1px solid #d1d5db; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
        <ul style="margin: 0 0 12px; padding-left: 20px; font-size: 15px;">
          <li>Your certificate</li>
          <li>Documents</li>
          <li>More shares</li>
          <li>Withdrawals</li>
          <li>Premium features</li>
        </ul>
        <p style="margin: 0 0 12px; font-size: 14px; color: #4b5563;">The process takes a couple of minutes from your phone.</p>
        <a href="${KYC_URL}" style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">Start KYC Verification</a>
      </div>

      <p style="font-size: 14px; color: #4b5563; margin: 0 0 4px;">Best regards,</p>
      <p style="font-size: 14px; color: #4b5563; margin: 0 0 20px;">AfriMobile</p>

      <p style="font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 16px; margin: 0;">
        You are receiving this email because you have an AfriMobile account.
        If you have any questions, just reply to this email.
      </p>
    </div>
  </div>`;
}

function buildText(firstName) {
  const name = firstName || 'there';
  return `Hello ${name},

KYC verification is now available on AfriMobile. Verify your identity to unlock:

- Your certificate
- Documents
- More shares
- Withdrawals
- Premium features

The process takes a couple of minutes from your phone.
Start KYC Verification: ${KYC_URL}

Best regards,
AfriMobile

---
You are receiving this email because you have an AfriMobile account. If you have any questions, just reply to this email.`;
}

module.exports = { SUBJECT, buildHtml, buildText };