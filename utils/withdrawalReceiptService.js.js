// utils/withdrawalReceiptService.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const moment = require('moment');

/**
 * Generate a PDF receipt for a withdrawal
 * @param {Object} withdrawal - Withdrawal object with all details
 * @param {Object} user - User object
 * @returns {Promise<String>} - Path to the generated PDF file
 */
const generateWithdrawalReceipt = async (withdrawal, user) => {
  return new Promise((resolve, reject) => {
    try {
      // Create a unique filename
      const fileName = `withdrawal-${withdrawal._id}-${Date.now()}.pdf`;
      const filePath = path.join(__dirname, '../public/receipts', fileName);
      
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Create a PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: 'Withdrawal Receipt',
          Author: 'Afrimobile',
          Subject: 'Withdrawal Receipt',
        }
      });
      
      // Pipe the PDF to the file
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      
      // Add logo
      const logoPath = path.join(__dirname, '../public/images/logo.svg');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 140 });
      }
      
      // Add heading
      doc.fontSize(20)
        .fillColor('#5A19A0')
        .text('WITHDRAWAL RECEIPT', { align: 'center' })
        .moveDown(0.5);
      
      // Add receipt border
      doc.rect(50, 130, 500, 480)
        .lineWidth(2)
        .stroke('#5A19A0');
      
      // Add receipt content
      doc.fontSize(12)
        .fillColor('#333333')
        .text('TRANSACTION DETAILS', 70, 150)
        .moveDown(0.5);
      
      // Add divider
      doc.moveTo(70, 175)
        .lineTo(530, 175)
        .lineWidth(1)
        .stroke('#CCCCCC');
      
      // Add transaction details
      doc.fontSize(10)
        .text('Transaction ID:', 70, 190)
        .text(withdrawal._id.toString(), 200, 190)
        .text('Date:', 70, 215)
        .text(moment(withdrawal.createdAt).format('MMMM Do, YYYY - h:mm A'), 200, 215)
        .text('Status:', 70, 240)
        .text(withdrawal.status.charAt(0).toUpperCase() + withdrawal.status.slice(1), 200, 240)
        .text('Transaction Reference:', 70, 265)
        .text(withdrawal.transactionReference || withdrawal.clientReference || 'N/A', 200, 265);
      
      // Add divider
      doc.moveTo(70, 290)
        .lineTo(530, 290)
        .lineWidth(1)
        .stroke('#CCCCCC');
      
      // Add user details section
      doc.fontSize(12)
        .fillColor('#333333')
        .text('USER DETAILS', 70, 305)
        .moveDown(0.5);
      
      // Add divider
      doc.moveTo(70, 330)
        .lineTo(530, 330)
        .lineWidth(1)
        .stroke('#CCCCCC');
      
      // Add user details
      doc.fontSize(10)
        .text('Name:', 70, 345)
        .text(user.name, 200, 345)
        .text('Email:', 70, 370)
        .text(user.email, 200, 370);
      
      // Add divider
      doc.moveTo(70, 395)
        .lineTo(530, 395)
        .lineWidth(1)
        .stroke('#CCCCCC');
      
      // Add payment details section
      doc.fontSize(12)
        .fillColor('#333333')
        .text('PAYMENT DETAILS', 70, 410)
        .moveDown(0.5);
      
      // Add divider
      doc.moveTo(70, 435)
        .lineTo(530, 435)
        .lineWidth(1)
        .stroke('#CCCCCC');
      
      // Add payment details
      doc.fontSize(10)
        .text('Amount:', 70, 450)
        .text(`₦${withdrawal.amount.toLocaleString()}`, 200, 450)
        .text('Payment Method:', 70, 475)
        .text(withdrawal.paymentMethod.charAt(0).toUpperCase() + withdrawal.paymentMethod.slice(1), 200, 475);
      
      // Add bank details if available
      if (withdrawal.paymentMethod === 'bank' && withdrawal.paymentDetails) {
        doc.text('Bank Name:', 70, 500)
          .text(withdrawal.paymentDetails.bankName || 'N/A', 200, 500)
          .text('Account Number:', 70, 525)
          .text(withdrawal.paymentDetails.accountNumber || 'N/A', 200, 525)
          .text('Account Name:', 70, 550)
          .text(withdrawal.paymentDetails.accountName || 'N/A', 200, 550);
      } else if (withdrawal.paymentMethod === 'crypto' && withdrawal.paymentDetails) {
        doc.text('Crypto Type:', 70, 500)
          .text(withdrawal.paymentDetails.cryptoType || 'N/A', 200, 500)
          .text('Wallet Address:', 70, 525)
          .text(withdrawal.paymentDetails.walletAddress || 'N/A', 200, 525);
      } else if (withdrawal.paymentMethod === 'mobile_money' && withdrawal.paymentDetails) {
        doc.text('Mobile Provider:', 70, 500)
          .text(withdrawal.paymentDetails.mobileProvider || 'N/A', 200, 500)
          .text('Mobile Number:', 70, 525)
          .text(withdrawal.paymentDetails.mobileNumber || 'N/A', 200, 525);
      }
      
      // Add footer
      doc.fontSize(8)
        .fillColor('#666666')
        .text('Afrimobile - Your Time', 50, 630, { align: 'center' })
        .text('This is an electronically generated receipt and does not require a signature.', 50, 645, { align: 'center' });
      
      // Finalize the PDF
      doc.end();
      
      stream.on('finish', () => {
        resolve({
          filePath: `/receipts/${fileName}`,
          fileName: fileName
        });
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  generateWithdrawalReceipt
};