// utils/broadcastTemplateNoShares.js - Email template for AfriMobile users
// who don't yet own shares, inviting them to invest ahead of KYC.
const SITE_URL = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
const BUY_SHARES_URL = `${SITE_URL}/dashboard/buy-shares`;
const COFOUNDER_URL = `${SITE_URL}/dashboard/buy/cofounder`;

const SUBJECT = 'AfriMobile is moving forward with KYC — it’s not too late to join the train';

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
        Great news — AfriMobile is moving forward with KYC verification for our investors.
        We’re on-boarding and verifying every shareholder, and we’d love for you to be part of it.
      </p>
      <p style="font-size: 15px; margin: 0 0 20px;">
        It’s <strong>not too late to join the train</strong>. By buying your shares now, you become a
        shareholder and unlock:
      </p>

      <div style="border: 1px solid #d1d5db; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
        <ul style="margin: 0 0 12px; padding-left: 20px; font-size: 15px;">
          <li>KYC verification access</li>
          <li>Your shareholder certificate &amp; documents</li>
          <li>The co-founder space</li>
          <li>Withdrawals &amp; premium features</li>
        </ul>
        <p style="margin: 0 0 12px; font-size: 14px; color: #4b5563;">Buying takes just a few minutes from your phone.</p>
        <a href="${BUY_SHARES_URL}" style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; margin-right: 8px;">Buy Shares</a>
        <a href="${COFOUNDER_URL}" style="display: inline-block; background: #7c3aed; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">Become a Co-Founder</a>
      </div>

      <p style="font-size: 14px; color: #4b5563; margin: 0 0 4px;">Best regards,</p>
      <p style="font-size: 14px; color: #4b5563; margin: 0 0 20px;">AfriMobile Team</p>

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

Great news — AfriMobile is moving forward with KYC verification for our investors.
We're on-boarding and verifying every shareholder, and we'd love for you to be part of it.

It's not too late to join the train. By buying your shares now, you become a shareholder
and unlock:

- KYC verification access
- Your shareholder certificate & documents
- The co-founder space
- Withdrawals & premium features

Buying takes just a few minutes from your phone.
Buy Shares: ${BUY_SHARES_URL}
Become a Co-Founder: ${COFOUNDER_URL}

Best regards,
AfriMobile Team

---
You are receiving this email because you have an AfriMobile account. If you have any questions, just reply to this email.`;
}

module.exports = { SUBJECT, buildHtml, buildText };
