// utils/emailTemplates.js

// Template for password reset email
const passwordResetTemplate = (resetUrl) => {
    return `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="background: linear-gradient(to right, #6d28d9, #8b5cf6); padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0;">Reset Your Password</h1>
        </div>
        <div style="background-color: #1f2937; padding: 20px; color: #e5e7eb; border-radius: 0 0 10px 10px;">
          <p>Hello,</p>
          <p>We received a request to reset your password for your AfriMobile account. Please click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: linear-gradient(to right, #6d28d9, #8b5cf6); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <p>This password reset link will expire in 10 minutes for security reasons.</p>
          <hr style="border: 0; border-top: 1px solid #374151; margin: 20px 0;">
          <p style="font-size: 12px; color: #9ca3af;">AfriMobile - Your Digital Companion</p>
        </div>
      </div>
    `;
  };
  
  // Template for password change confirmation
  const passwordChangedTemplate = (name, loginUrl) => {
    return `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="background: linear-gradient(to right, #6d28d9, #8b5cf6); padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0;">Password Changed Successfully</h1>
        </div>
        <div style="background-color: #1f2937; padding: 20px; color: #e5e7eb; border-radius: 0 0 10px 10px;">
          <p>Hello ${name || 'there'},</p>
          <p>Your password for AfriMobile has been changed successfully.</p>
          <p>If you did not make this change, please contact our support team immediately as your account may have been compromised.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background: linear-gradient(to right, #6d28d9, #8b5cf6); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Login to Your Account</a>
          </div>
          <hr style="border: 0; border-top: 1px solid #374151; margin: 20px 0;">
          <p style="font-size: 12px; color: #9ca3af;">AfriMobile - Your Digital Companion</p>
        </div>
      </div>
    `;
  };
  
  // Template for welcome email
  const welcomeTemplate = (name, loginUrl) => {
    return `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <div style="background: linear-gradient(to right, #6d28d9, #8b5cf6); padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0;">Welcome to AfriMobile!</h1>
        </div>
        <div style="background-color: #1f2937; padding: 20px; color: #e5e7eb; border-radius: 0 0 10px 10px;">
          <p>Hello ${name || 'there'},</p>
          <p>Thank you for creating an account with AfriMobile. We're excited to have you join our community!</p>
          <p>You can now access all the features and services offered by AfriMobile.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background: linear-gradient(to right, #6d28d9, #8b5cf6); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Login to Your Account</a>
          </div>
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          <hr style="border: 0; border-top: 1px solid #374151; margin: 20px 0;">
          <p style="font-size: 12px; color: #9ca3af;">AfriMobile - Your Digital Companion</p>
        </div>
      </div>
    `;
  };
  
  module.exports = {
    passwordResetTemplate,
    passwordChangedTemplate,
    welcomeTemplate
  };