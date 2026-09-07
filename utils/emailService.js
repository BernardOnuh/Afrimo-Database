
// utils/emailService.js
const nodemailer = require('nodemailer');

// Resend (dedicated sending provider) is used when RESEND_API_KEY is set.
// Gmail SMTP remains as a fallback. Resend gives proper SPF/DKIM/DMARC and
// reliable inbox delivery for bulk/broadcast mail.
const createResend = () => {
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  return new Resend(process.env.RESEND_API_KEY);
};

// Configure email transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER || 'theafrimol@gmail.com',
      pass: process.env.EMAIL_PASS || 'nszs pjca vgss wqxk'
    },
    // Adding deliverability settings
    pool: true,
    maxConnections: 1,
    maxMessages: 10,
    rateDelta: 15000,
    rateLimit: 5,
  });
};

// Send email function
const sendEmail = async (options) => {
  const resend = createResend();

  if (resend) {
    try {
      const senderName = process.env.EMAIL_FROM_NAME || 'AfriMobile Team';
      const from = options.from || `${senderName} <${process.env.RESEND_FROM_ADDRESS || 'news@afrimobiletech.com'}>`;

      const { data, error } = await resend.emails.send({
        from,
        to: [options.email],
        subject: options.subject,
        text: options.text || extractTextFromHTML(options.html),
        html: options.html,
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      });

      if (error) {
        console.error('Resend email error:', error);
        return false;
      }
      console.log(`Resend email sent to ${options.email}:`, data?.id);
      return true;
    } catch (error) {
      console.error('Resend sending failed:', error);
      return false;
    }
  }

  try {
    const transporter = createTransporter();
    
    // Create better formatted sender name
    const senderName = process.env.EMAIL_FROM_NAME || 'AfriMobile Team';
    
    const mailOptions = {
      from: {
        name: senderName,
        address: process.env.EMAIL_USER || 'theweb3nova@gmail.com'
      },
      to: options.email,
      subject: options.subject,
      // Include both plain text and HTML versions
      text: options.text || extractTextFromHTML(options.html),
      html: options.html,
      // Priority is configurable per-send. Bulk/marketing mail should pass
      // priority: 'normal' - 'high' on bulk mail is a spam signal.
      priority: options.priority || 'high'
    };

    // Support attachments (e.g., certificate images)
    if (options.attachments) {
      mailOptions.attachments = options.attachments;
    }

    // Support caller-supplied headers (e.g. List-Unsubscribe for broadcasts)
    if (options.headers) {
      mailOptions.headers = { ...(mailOptions.headers || {}), ...options.headers };
    }
    
    console.log(`Attempting to send email to: ${options.email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Email sending failed:', error);
    return false;
  }
};

// Helper function to extract plain text from HTML
function extractTextFromHTML(html) {
  return html.replace(/<[^>]*>?/gm, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { sendEmail };