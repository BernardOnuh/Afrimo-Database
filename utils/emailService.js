
// utils/emailService.js
const nodemailer = require('nodemailer');

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
    // Setting proper headers
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      'Importance': 'High'
    }
  });
};

// Send email function
const sendEmail = async (options) => {
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
      // Add priority headers to reduce spam likelihood
      priority: 'high'
    };
    
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