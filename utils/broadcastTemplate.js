// utils/broadcastTemplate.js - Shared email template for the KYC + shares broadcast.
const SITE_URL = process.env.FRONTEND_URL || 'https://www.afrimobiletech.com';
const KYC_URL = `${SITE_URL}/dashboard/kyc`;
const BUY_SHARES_URL = `${SITE_URL}/dashboard/buy-shares`;

const SUBJECT = 'Complete your KYC and check out the new shares offer';

function buildHtml(firstName) {
  const name = firstName || 'there';
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
    <div style="background: #111827; padding: 20px 32px; border-radius: 12px 12px 0 0;">
      <span style="color: #ffffff; font-size: 20px; font-weight: bold;">AfriMobile</span>
    </div>
    <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 32px;">
      <p style="font-size: 16px; margin: 0 0 20px;">Hello ${name},</p>
      <p style="font-size: 15px; margin: 0 0 24px;">AfriMobile has two updates for you:</p>

      <div style="border: 1px solid #d1d5db; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px; color: #111827; font-size: 17px;">Complete identity verification (KYC)</h2>
        <p style="margin: 0 0 12px; font-size: 15px;">Verify your identity to access premium features and higher withdrawal limits. The process takes a couple of minutes from your phone.</p>
        <a href="${KYC_URL}" style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">Go to KYC Verification</a>
      </div>

      <div style="border: 1px solid #d1d5db; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px; color: #111827; font-size: 17px;">New offer: buy shares</h2>
        <p style="margin: 0 0 12px; font-size: 15px;">Invest in AfriMobile shares by purchasing them directly from your dashboard.</p>
        <a href="${BUY_SHARES_URL}" style="display: inline-block; border: 1px solid #111827; color: #111827; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">View the shares offer</a>
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

AfriMobile has two updates for you:

1) Complete identity verification (KYC)
Verify your identity to access premium features and higher withdrawal limits. The process takes a couple of minutes from your phone.
Go to KYC Verification: ${KYC_URL}

2) New offer: buy shares
Invest in AfriMobile shares by purchasing them directly from your dashboard.
View the shares offer: ${BUY_SHARES_URL}

Best regards,
AfriMobile

---
You are receiving this email because you have an AfriMobile account. If you have any questions, just reply to this email.`;
}

module.exports = { SUBJECT, buildHtml, buildText };