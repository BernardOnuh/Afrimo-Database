const express = require('express');
const router = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const fc = require('../controller/franchiseController');
const { sharePaymentUpload } = require('../config/cloudinary');

// ===== User (franchise vendor) =====
router.post('/apply', protect, fc.applyForFranchise);
router.get('/my-profile', protect, fc.getMyFranchise);
router.put('/bank-details', protect, fc.updateBankDetails);
router.post('/buy-bulk', protect, sharePaymentUpload.single('paymentProof'), fc.buyBulk);
router.post('/packages', protect, fc.createPackage);
router.put('/packages/:packageId', protect, fc.updatePackage);
router.delete('/packages/:packageId', protect, fc.deletePackage);
router.get('/my-sales', protect, fc.getMySales);
router.put('/validate/:transactionId', protect, fc.validatePayment);
router.put('/reject/:transactionId', protect, fc.rejectPayment);

// ===== Buyer =====
router.get('/list', protect, fc.listFranchises);
router.get('/my-purchases', protect, fc.getMyPurchases);
router.get('/:franchiseId/detail', protect, fc.getFranchiseDetail);
router.post('/:franchiseId/buy', protect, sharePaymentUpload.single('paymentProof'), fc.buyFromFranchise);
router.post('/dispute/:transactionId', protect, fc.raiseDispute);

// ===== Admin =====
router.get('/admin/list', protect, adminProtect, fc.adminListFranchises);
router.get('/admin/stats', protect, adminProtect, fc.adminStats);
router.get('/admin/transactions', protect, adminProtect, fc.adminGetTransactions);
router.put('/admin/:franchiseId/status', protect, adminProtect, fc.adminUpdateStatus);
router.put('/admin/:franchiseId/approve-bulk/:purchaseIndex', protect, adminProtect, fc.adminApproveBulk);
router.put('/admin/resolve-dispute/:transactionId', protect, adminProtect, fc.adminResolveDispute);

module.exports = router;
