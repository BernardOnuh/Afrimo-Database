const express = require('express');
const router = express.Router();
const shareListingController = require('../controller/Sharelistingcontroller');
const { protect, adminProtect } = require('../middleware/auth');
const { sharePaymentUpload } = require('../config/cloudinary');

/**
 * ============================================================================
 * SHARE RESALE & OTC MARKETPLACE ROUTES WITH ADMIN INTEGRATION
 * ============================================================================
 * 
 * This module implements:
 * - Peer-to-peer share trading system
 * - Admin transaction management and mediation
 * - Stuck transaction resolution
 * - Complete audit trail
 */

// ============================================================================
// PUBLIC ROUTES - Share Marketplace (No Authentication Required)
// ============================================================================

/**
 * @swagger
 * /shares/listings:
 *   get:
 *     summary: Browse all active share listings
 *     description: Retrieve paginated list of active share listings with optional filtering by price, currency, and share type
 *     tags:
 *       - Marketplace
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of listings per page
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: ['naira', 'usdt']
 *         description: Filter by currency
 *       - in: query
 *         name: shareType
 *         schema:
 *           type: string
 *           enum: ['regular', 'cofounder']
 *         description: Filter by share type
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum price per share
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price per share
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in listing description
 *     responses:
 *       200:
 *         description: Successfully retrieved listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 */
router.get('/listings', shareListingController.getShareListings);

/**
 * @swagger
 * /shares/listings/{listingId}:
 *   get:
 *     summary: Get detailed information about a specific listing
 *     description: Retrieve complete details of a share listing including seller info and payment methods
 *     tags:
 *       - Marketplace
 *     parameters:
 *       - in: path
 *         name: listingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The listing ID
 *     responses:
 *       200:
 *         description: Successfully retrieved listing
 *       404:
 *         description: Listing not found
 */
router.get('/listings/:listingId', shareListingController.getShareListing);

// ============================================================================
// PRIVATE ROUTES - Seller Functions (Authentication Required)
// ============================================================================

/**
 * @swagger
 * /shares/listings:
 *   post:
 *     summary: Create a new share listing
 *     description: Seller creates a new listing to sell their shares on the marketplace
 *     tags:
 *       - Seller Functions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shares
 *               - shareType
 *               - pricePerShare
 *               - currency
 *               - paymentMethods
 *             properties:
 *               shares:
 *                 type: number
 *                 description: Number of shares to sell
 *                 example: 100
 *               shareType:
 *                 type: string
 *                 enum: ['regular', 'cofounder']
 *                 example: regular
 *               pricePerShare:
 *                 type: number
 *                 description: Price per share
 *                 example: 5000
 *               currency:
 *                 type: string
 *                 enum: ['naira', 'usdt']
 *                 example: naira
 *               paymentMethods:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: ['bank_transfer', 'crypto']
 *                 example: ['bank_transfer']
 *               bankDetails:
 *                 type: object
 *                 properties:
 *                   accountName:
 *                     type: string
 *                     example: John Doe
 *                   accountNumber:
 *                     type: string
 *                     example: "1234567890"
 *                   bankName:
 *                     type: string
 *                     example: GTBank
 *                   country:
 *                     type: string
 *                     example: Nigeria
 *               cryptoWallet:
 *                 type: object
 *                 properties:
 *                   address:
 *                     type: string
 *                   network:
 *                     type: string
 *                     example: BSC
 *                   currency:
 *                     type: string
 *                     example: USDT
 *               description:
 *                 type: string
 *                 description: Additional listing details
 *               minSharesPerBuy:
 *                 type: number
 *                 description: Minimum shares per purchase (default 1)
 *                 example: 10
 *               maxSharesPerBuyer:
 *                 type: number
 *                 description: Maximum shares per buyer (default all)
 *                 example: 50
 *               expirationDays:
 *                 type: number
 *                 description: Days until listing expires (default 30)
 *                 example: 30
 *               isPublic:
 *                 type: boolean
 *                 description: Whether listing is publicly visible
 *                 example: true
 *     responses:
 *       201:
 *         description: Listing created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 */
router.post('/listings', protect, shareListingController.createShareListing);

/**
 * @swagger
 * /shares/my-listings:
 *   get:
 *     summary: Get your share listings
 *     description: Retrieve all listings created by the authenticated user
 *     tags:
 *       - Seller Functions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ['active', 'partially_sold', 'sold', 'cancelled']
 *         description: Filter by listing status
 *     responses:
 *       200:
 *         description: Successfully retrieved user's listings
 *       401:
 *         description: Authentication required
 */
router.get('/my-listings', protect, shareListingController.getUserListings);

/**
 * @swagger
 * /shares/listings/{listingId}/cancel:
 *   post:
 *     summary: Cancel a share listing
 *     description: Seller cancels their listing (only if no accepted offers)
 *     tags:
 *       - Seller Functions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Listing cancelled successfully
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Listing not found
 *       403:
 *         description: Cannot cancel - listing has accepted offers
 */
router.post('/listings/:listingId/cancel', protect, shareListingController.cancelShareListing);

// ============================================================================
// PRIVATE ROUTES - Purchase Offers (Authentication Required)
// ============================================================================

/**
 * @swagger
 * /shares/listings/{listingId}/offer:
 *   post:
 *     summary: Make a purchase offer on a listing
 *     description: Buyer creates a purchase offer to buy shares from a listing
 *     tags:
 *       - Purchase Offers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: listingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shares
 *               - paymentMethod
 *             properties:
 *               shares:
 *                 type: number
 *                 description: Number of shares to purchase
 *                 example: 50
 *               paymentMethod:
 *                 type: string
 *                 enum: ['bank_transfer', 'crypto']
 *                 example: bank_transfer
 *               notes:
 *                 type: string
 *                 description: Optional message to seller
 *     responses:
 *       201:
 *         description: Purchase offer created
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Listing not found
 */
router.post('/listings/:listingId/offer', protect, shareListingController.createPurchaseOffer);

/**
 * @swagger
 * /shares/offers/{offerId}/accept:
 *   post:
 *     summary: Accept a purchase offer
 *     description: Seller accepts a purchase offer and sets 48-hour payment deadline
 *     tags:
 *       - Purchase Offers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: offerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Offer accepted successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Only seller can accept this offer
 */
router.post('/offers/:offerId/accept', protect, shareListingController.acceptPurchaseOffer);

/**
 * @swagger
 * /shares/offers/{offerId}/decline:
 *   post:
 *     summary: Decline a purchase offer
 *     description: Seller declines a purchase offer
 *     tags:
 *       - Purchase Offers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: offerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for declining
 *     responses:
 *       200:
 *         description: Offer declined
 *       401:
 *         description: Authentication required
 */
router.post('/offers/:offerId/decline', protect, shareListingController.declinePurchaseOffer);

// ============================================================================
// PRIVATE ROUTES - Payment & Automatic Transfer
// ============================================================================

/**
 * @swagger
 * /shares/offers/{offerId}/payment:
 *   post:
 *     summary: Submit payment proof for share purchase
 *     description: Buyer submits payment proof (bank transfer receipt or crypto transaction hash)
 *     tags:
 *       - Payment & Transfer
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: offerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - transactionReference
 *             properties:
 *               transactionReference:
 *                 type: string
 *                 description: Bank transfer reference or crypto tx hash
 *                 example: "TXN123456789"
 *               bankTransferDetails:
 *                 type: object
 *                 description: Required for bank transfer (JSON string)
 *                 properties:
 *                   bankName:
 *                     type: string
 *                   senderName:
 *                     type: string
 *                   amount:
 *                     type: number
 *                   transferDate:
 *                     type: string
 *                     format: date
 *               cryptoTransferDetails:
 *                 type: object
 *                 description: Required for crypto transfer (JSON string)
 *                 properties:
 *                   fromAddress:
 *                     type: string
 *                   toAddress:
 *                     type: string
 *                   txHash:
 *                     type: string
 *                   network:
 *                     type: string
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Receipt image/document
 *     responses:
 *       200:
 *         description: Payment submitted successfully
 *       401:
 *         description: Authentication required
 */
router.post('/offers/:offerId/payment', protect, sharePaymentUpload.single('paymentProof'), shareListingController.submitPaymentForShare);

/**
 * @swagger
 * /shares/offers/{offerId}/confirm-payment:
 *   post:
 *     summary: Confirm payment and transfer shares
 *     description: Seller verifies payment and confirms transfer. Shares automatically transfer to buyer's account.
 *     tags:
 *       - Payment & Transfer
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: offerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               verificationNotes:
 *                 type: string
 *                 description: Optional verification notes
 *     responses:
 *       200:
 *         description: Payment confirmed and shares transferred
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Only seller can confirm payment for this offer
 *       409:
 *         description: Payment already confirmed or offer cancelled
 */
router.post('/offers/:offerId/confirm-payment', protect, shareListingController.confirmPaymentAndTransfer);

// ============================================================================
// ADDITIONAL UTILITY ROUTES
// ============================================================================

/**
 * @swagger
 * /shares/transfer-history:
 *   get:
 *     summary: Get share transfer history
 *     description: View all share transfers (sent and received)
 *     tags:
 *       - Transfer History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ['pending', 'in_progress', 'completed', 'failed']
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Transfer history retrieved
 *       401:
 *         description: Authentication required
 */
router.get('/transfer-history', protect, shareListingController.getTransferHistory);

/**
 * @swagger
 * /shares/offers:
 *   get:
 *     summary: Get your purchase offers
 *     description: View all purchase offers (sent and received)
 *     tags:
 *       - Purchase Offers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: ['sent', 'received']
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ['pending', 'accepted', 'in_payment', 'completed', 'cancelled']
 *     responses:
 *       200:
 *         description: Offers retrieved successfully
 *       401:
 *         description: Authentication required
 */
router.get('/offers', protect, shareListingController.getUserOffers);

// ============================================================================
// ADMIN ROUTES - TRANSACTION MANAGEMENT & MEDIATION
// ============================================================================

/**
 * @swagger
 * /shares/admin/dashboard:
 *   get:
 *     summary: Get transaction dashboard overview
 *     description: Real-time overview of all transactions, stuck transactions, and metrics
 *     tags:
 *       - Admin Dashboard
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/dashboard', protect, adminProtect, shareListingController.getDashboard);

/**
 * @swagger
 * /shares/admin/transactions:
 *   get:
 *     summary: Get all transactions with filters
 *     description: View all transactions with status, type, and date filtering
 *     tags:
 *       - Admin Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ['pending', 'accepted', 'in_payment', 'completed', 'cancelled', 'disputed']
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: ['offer', 'transfer', 'percentage_offer']
 *       - in: query
 *         name: days
 *         schema:
 *           type: number
 *           default: 30
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transactions retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/transactions', protect, adminProtect, shareListingController.getAllTransactions);

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}:
 *   get:
 *     summary: Get transaction details
 *     description: View complete transaction details with full history
 *     tags:
 *       - Admin Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction details retrieved
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/transactions/:transactionId', protect, adminProtect, shareListingController.getTransactionDetails);

// ============================================================================
// STUCK TRANSACTION ROUTES
// ============================================================================

/**
 * @swagger
 * /shares/admin/stuck:
 *   get:
 *     summary: Get stuck transactions
 *     description: View transactions stuck for more than X hours
 *     tags:
 *       - Admin Stuck Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: hoursStuck
 *         schema:
 *           type: number
 *           default: 24
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Stuck transactions list
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/stuck', protect, adminProtect, shareListingController.getStuckTransactions);

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/flag-stuck:
 *   post:
 *     summary: Flag transaction as stuck
 *     description: Mark transaction as stuck and add to dispute queue
 *     tags:
 *       - Admin Stuck Transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Payment not received after 48 hours"
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction flagged as stuck
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/transactions/:transactionId/flag-stuck', protect, adminProtect, shareListingController.flagTransactionAsStuck);

// ============================================================================
// FORCE COMPLETE TRANSACTION
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/force-complete:
 *   post:
 *     summary: Force complete a transaction
 *     description: Admin force completes a stuck transaction. Transfers shares to buyer, updates balances, sends notifications, and creates audit log.
 *     tags:
 *       - Admin Transaction Actions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - adminReason
 *             properties:
 *               adminReason:
 *                 type: string
 *                 description: Reason for force completing
 *                 example: "Payment verified via bank statement"
 *               adminNotes:
 *                 type: string
 *                 description: Additional admin notes
 *               verificationProof:
 *                 type: string
 *                 description: Link or reference to proof
 *     responses:
 *       200:
 *         description: Transaction force completed
 *       400:
 *         description: Invalid transaction state for completion
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/transactions/:transactionId/force-complete', protect, adminProtect, shareListingController.forceCompleteTransaction);

// ============================================================================
// TRANSACTION CANCELLATION
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/cancel:
 *   post:
 *     summary: Cancel a transaction
 *     description: Admin cancels a transaction. Reverts transfers, releases shares, sends notifications, and creates audit log.
 *     tags:
 *       - Admin Transaction Actions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 enum: ['buyer_request', 'seller_request', 'fraud_detected', 'system_error', 'payment_failed', 'other']
 *               adminNotes:
 *                 type: string
 *               refundBuyer:
 *                 type: boolean
 *                 default: true
 *               refundAmount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transaction cancelled
 *       400:
 *         description: Invalid transaction state for cancellation
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/transactions/:transactionId/cancel', protect, adminProtect, shareListingController.cancelTransaction);

// ============================================================================
// TRANSACTION DELETION
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/delete:
 *   delete:
 *     summary: Delete a transaction
 *     description: PERMANENT deletion of a transaction. Only cancelled/failed transactions can be deleted. Creates audit log before deletion.
 *     tags:
 *       - Admin Transaction Actions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - confirmDeletion
 *               - reason
 *             properties:
 *               confirmDeletion:
 *                 type: boolean
 *                 description: Must be true to confirm deletion
 *               reason:
 *                 type: string
 *                 enum: ['duplicate', 'test_transaction', 'data_error', 'system_cleanup', 'other']
 *               adminNotes:
 *                 type: string
 *               notifyUsers:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Transaction deleted
 *       400:
 *         description: Transaction cannot be deleted
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.delete('/admin/transactions/:transactionId/delete', protect, adminProtect, shareListingController.deleteTransaction);

// ============================================================================
// REFUND PROCESSING
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/refund:
 *   post:
 *     summary: Process refund for transaction
 *     description: Admin processes refund for a transaction. Issues refund, updates status, and sends notification.
 *     tags:
 *       - Admin Transaction Actions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Refund amount (full transaction amount if not specified)
 *               reason:
 *                 type: string
 *                 description: Reason for refund
 *               method:
 *                 type: string
 *                 enum: ['original_payment', 'bank_transfer', 'wallet_credit', 'manual']
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Refund processed
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/transactions/:transactionId/refund', protect, adminProtect, shareListingController.processRefund);

// ============================================================================
// DISPUTE MANAGEMENT
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/create-dispute:
 *   post:
 *     summary: Create dispute for transaction
 *     description: Open formal dispute for transaction requiring investigation
 *     tags:
 *       - Admin Disputes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute created
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/transactions/:transactionId/create-dispute', protect, adminProtect, shareListingController.createDispute);

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/resolve-dispute:
 *   post:
 *     summary: Resolve dispute
 *     description: Resolve a dispute with final decision (award buyer, award seller, or mediation)
 *     tags:
 *       - Admin Disputes
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - decision
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: ['award_buyer', 'award_seller', 'mediation', 'refund']
 *               reason:
 *                 type: string
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute resolved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/transactions/:transactionId/resolve-dispute', protect, adminProtect, shareListingController.resolveDispute);

// ============================================================================
// STATUS UPDATE
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/update-status:
 *   patch:
 *     summary: Manually update transaction status
 *     description: Change transaction status directly (use with caution)
 *     tags:
 *       - Admin Transaction Actions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newStatus:
 *                 type: string
 *               reason:
 *                 type: string
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction status updated
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.patch('/admin/transactions/:transactionId/update-status', protect, adminProtect, shareListingController.updateTransactionStatus);

// ============================================================================
// AUDIT LOGS
// ============================================================================

/**
 * @swagger
 * /shares/admin/transactions/{transactionId}/audit-log:
 *   get:
 *     summary: Get transaction audit log
 *     description: View complete history of all changes and actions on transaction
 *     tags:
 *       - Admin Audit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Audit log retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/transactions/:transactionId/audit-log', protect, adminProtect, shareListingController.getAuditLog);

/**
 * @swagger
 * /shares/admin/audit-logs:
 *   get:
 *     summary: Get all admin actions audit log
 *     description: View all admin actions performed on the system
 *     tags:
 *       - Admin Audit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: admin
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *       - in: query
 *         name: days
 *         schema:
 *           type: number
 *           default: 30
 *     responses:
 *       200:
 *         description: Audit logs retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/audit-logs', protect, adminProtect, shareListingController.getAdminAuditLogs);

// ============================================================================
// BULK TRANSACTION ROUTES
// ============================================================================

/**
 * @swagger
 * /shares/admin/bulk/complete:
 *   post:
 *     summary: Bulk complete transactions
 *     description: Force complete multiple transactions at once
 *     tags:
 *       - Admin Bulk Actions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               reason:
 *                 type: string
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bulk completion completed
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/bulk/complete', protect, adminProtect, shareListingController.bulkCompleteTransactions);

/**
 * @swagger
 * /api/shares/admin/bulk/cancel:
 *   post:
 *     summary: Bulk cancel transactions
 *     description: Cancel multiple transactions at once
 *     tags:
 *       - Admin Bulk Actions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transactionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               reason:
 *                 type: string
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bulk cancellation completed
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post('/admin/bulk/cancel', protect, adminProtect, shareListingController.bulkCancelTransactions);

// ============================================================================
// REPORTING ROUTES
// ============================================================================

/**
 * @swagger
 * /api/shares/admin/reports/daily:
 *   get:
 *     summary: Get daily transaction report
 *     description: Daily summary of all transactions
 *     tags:
 *       - Admin Reports
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Daily report retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/reports/daily', protect, adminProtect, shareListingController.getDailyReport);

/**
 * @swagger
 * /shares/admin/reports/stuck:
 *   get:
 *     summary: Get stuck transactions report
 *     description: Detailed report on all stuck transactions
 *     tags:
 *       - Admin Reports
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stuck transactions report retrieved
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.get('/admin/reports/stuck', protect, adminProtect, shareListingController.getStuckTransactionsReport);

module.exports = router;