const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { sharePaymentUpload } = require('../config/cloudinary');
const shareListingController = require('../controller/Sharelistingcontroller');

/**
 * ============================================================================
 * SHARE RESALE & OTC MARKETPLACE ROUTES WITH SWAGGER DOCUMENTATION
 * ============================================================================
 * 
 * This module implements a peer-to-peer share trading system enabling:
 * - Users to list shares for sale
 * - Buyers to make purchase offers
 * - Sellers to accept/decline offers
 * - Payment processing (bank transfer or crypto)
 * - Automatic share transfers upon payment confirmation
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ShareListing:
 *       type: object
 *       required:
 *         - shares
 *         - shareType
 *         - pricePerShare
 *         - currency
 *         - paymentMethods
 *       properties:
 *         listingId:
 *           type: string
 *           description: Unique listing identifier
 *         seller:
 *           type: string
 *           description: User ID of the seller
 *         shares:
 *           type: number
 *           description: Number of shares being listed
 *         shareType:
 *           type: string
 *           enum: ['regular', 'cofounder']
 *           description: Type of shares
 *         pricePerShare:
 *           type: number
 *           description: Price per individual share
 *         currency:
 *           type: string
 *           enum: ['naira', 'usdt']
 *           description: Currency for pricing
 *         totalPrice:
 *           type: number
 *           description: Total listing price (calculated)
 *         status:
 *           type: string
 *           enum: ['active', 'partially_sold', 'sold', 'cancelled']
 *           description: Current status of listing
 *         sharesSold:
 *           type: number
 *           description: Number of shares sold
 *         sharesAvailable:
 *           type: number
 *           description: Number of shares still available
 *         paymentMethods:
 *           type: array
 *           items:
 *             type: string
 *             enum: ['bank_transfer', 'crypto', 'wallet_transfer', 'otc_direct']
 *           description: Accepted payment methods
 *         bankDetails:
 *           type: object
 *           properties:
 *             accountName:
 *               type: string
 *             accountNumber:
 *               type: string
 *             bankName:
 *               type: string
 *             country:
 *               type: string
 *           description: Bank details for bank transfer payments
 *         cryptoWallet:
 *           type: object
 *           properties:
 *             address:
 *               type: string
 *             network:
 *               type: string
 *             currency:
 *               type: string
 *           description: Crypto wallet for crypto payments
 *         description:
 *           type: string
 *           description: Additional listing description
 *         minSharesPerBuy:
 *           type: number
 *           description: Minimum shares per purchase
 *         maxSharesPerBuyer:
 *           type: number
 *           description: Maximum shares per buyer
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           description: Listing expiration date
 *         isPublic:
 *           type: boolean
 *           description: Whether listing is publicly visible
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     
 *     PurchaseOffer:
 *       type: object
 *       required:
 *         - shares
 *         - paymentMethod
 *       properties:
 *         offerId:
 *           type: string
 *           description: Unique offer identifier
 *         seller:
 *           type: string
 *           description: Seller user ID
 *         buyer:
 *           type: string
 *           description: Buyer user ID
 *         listing:
 *           type: string
 *           description: Reference listing ID
 *         shares:
 *           type: number
 *           description: Number of shares offered to buy
 *         pricePerShare:
 *           type: number
 *           description: Price per share at time of offer
 *         totalPrice:
 *           type: number
 *           description: Total offer price
 *         paymentMethod:
 *           type: string
 *           enum: ['bank_transfer', 'crypto']
 *           description: Selected payment method
 *         status:
 *           type: string
 *           enum: ['pending', 'accepted', 'in_payment', 'completed', 'cancelled']
 *           description: Current offer status
 *         paymentStatus:
 *           type: string
 *           enum: ['pending', 'processing', 'completed', 'failed']
 *           description: Payment processing status
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           description: Offer expiration (24 hours)
 *         paymentDeadline:
 *           type: string
 *           format: date-time
 *           description: Payment deadline after acceptance
 *     
 *     ShareTransfer:
 *       type: object
 *       properties:
 *         transferId:
 *           type: string
 *           description: Unique transfer identifier
 *         fromUser:
 *           type: string
 *           description: Seller user ID
 *         toUser:
 *           type: string
 *           description: Buyer user ID
 *         shareCount:
 *           type: number
 *           description: Number of shares transferred
 *         shareType:
 *           type: string
 *           enum: ['regular', 'cofounder']
 *         totalPrice:
 *           type: number
 *           description: Total transaction value
 *         status:
 *           type: string
 *           enum: ['pending', 'in_progress', 'completed', 'failed']
 *         createdAt:
 *           type: string
 *           format: date-time
 *   
 *   responses:
 *     ListingSuccess:
 *       description: Successfully retrieved listing
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *               message:
 *                 type: string
 *               data:
 *                 $ref: '#/components/schemas/ShareListing'
 *     
 *     UnauthorizedError:
 *       description: Authentication required
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Authentication required"
 *     
 *     NotFoundError:
 *       description: Resource not found
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               message:
 *                 type: string
 *                 example: "Listing not found"
 */

// ============================================================================
// PUBLIC ROUTES - Share Marketplace (No Authentication Required)
// ============================================================================

/**
 * @swagger
 * /api/shares/listings:
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
 *                     $ref: '#/components/schemas/ShareListing'
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
 * /api/shares/listings/{listingId}:
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
 *         $ref: '#/components/responses/ListingSuccess'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get('/listings/:listingId', shareListingController.getShareListing);

// ============================================================================
// PRIVATE ROUTES - Seller Functions (Authentication Required)
// ============================================================================

/**
 * @swagger
 * /api/shares/listings:
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
 *                   $ref: '#/components/schemas/ShareListing'
 *       400:
 *         description: Invalid input
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/listings', protect, shareListingController.createShareListing);

/**
 * @swagger
 * /api/shares/my-listings:
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ShareListing'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/my-listings', protect, shareListingController.getUserListings);

/**
 * @swagger
 * /api/shares/listings/{listingId}/cancel:
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
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 *       403:
 *         description: Cannot cancel - listing has accepted offers
 */
router.post('/listings/:listingId/cancel', protect, shareListingController.cancelShareListing);

// ============================================================================
// PRIVATE ROUTES - Purchase Offers (Authentication Required)
// ============================================================================

/**
 * @swagger
 * /api/shares/listings/{listingId}/offer:
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PurchaseOffer'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.post('/listings/:listingId/offer', protect, shareListingController.createPurchaseOffer);

/**
 * @swagger
 * /api/shares/offers/{offerId}/accept:
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Offer accepted. Awaiting payment within 48 hours."
 *                 data:
 *                   $ref: '#/components/schemas/PurchaseOffer'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Only seller can accept this offer
 */
router.post('/offers/:offerId/accept', protect, shareListingController.acceptPurchaseOffer);

/**
 * @swagger
 * /api/shares/offers/{offerId}/decline:
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
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/offers/:offerId/decline', protect, shareListingController.declinePurchaseOffer);

// ============================================================================
// PRIVATE ROUTES - Payment & Automatic Transfer
// ============================================================================

/**
 * @swagger
 * /api/shares/offers/{offerId}/payment:
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Payment submitted. Awaiting seller verification."
 *                 data:
 *                   $ref: '#/components/schemas/PurchaseOffer'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post('/offers/:offerId/payment', protect, sharePaymentUpload.single('paymentProof'), shareListingController.submitPaymentForShare);

/**
 * @swagger
 * /api/shares/offers/{offerId}/confirm-payment:
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: "Payment verified! Shares transferred successfully."
 *                 data:
 *                   type: object
 *                   properties:
 *                     transfer:
 *                       $ref: '#/components/schemas/ShareTransfer'
 *                     offer:
 *                       $ref: '#/components/schemas/PurchaseOffer'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
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
 * /api/shares/transfer-history:
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
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/transfer-history', protect, shareListingController.getTransferHistory);

/**
 * @swagger
 * /api/shares/offers:
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
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/offers', protect, shareListingController.getUserOffers);

module.exports = router;