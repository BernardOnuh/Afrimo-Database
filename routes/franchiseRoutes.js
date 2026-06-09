/**
 * Franchise Routes — Recharge-Card Reseller Model
 *
 * Franchise packages (what franchise buys to get credit):
 *   Starter:    ₦800k  → ₦1M  distributable credit
 *   Standard:   ₦1.5M  → ₦2M  distributable credit
 *   Pro:        ₦2M    → ₦3M  distributable credit
 *   Enterprise: ₦5M    → ₦8M  distributable credit
 *
 * Flow:
 *   1. User registers as franchise (business details + package + payment proof) in ONE step
 *   2. Franchise is immediately ACTIVE (no admin approval for registration)
 *   3. Admin approves the credit purchase → credit added to franchise balance
 *   4. Buyers pay franchise directly, upload proof
 *   5. Franchise approves → credit deducted, shares released to buyer
 *   6. Franchise can also self-purchase (use own credit for their own portfolio)
 */

const express = require('express');
const router  = express.Router();
const { protect, adminProtect } = require('../middleware/auth');
const fc = require('../controller/franchiseController');
const { sharePaymentUpload } = require('../config/cloudinary');


// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /franchise/packages:
 *   get:
 *     tags: [Franchise - Public]
 *     summary: Get available franchise packages
 *     description: |
 *       Returns the four franchise packages that a user can buy to become a reseller.
 *       Each package gives the franchise a credit balance they can use to approve share
 *       purchases for buyers.
 *
 *       | Package    | Cost (₦) | Credit (₦) | Margin   |
 *       |------------|----------|------------|----------|
 *       | Starter    | 800,000  | 1,000,000  | 200,000  |
 *       | Standard   | 1,500,000| 2,000,000  | 500,000  |
 *       | Pro        | 2,000,000| 3,000,000  | 1,000,000|
 *       | Enterprise | 5,000,000| 8,000,000  | 3,000,000|
 *     responses:
 *       200:
 *         description: Packages returned successfully
 */
router.get('/packages', fc.getPackages);

/**
 * @swagger
 * /franchise/list:
 *   get:
 *     tags: [Franchise - Public]
 *     summary: List active franchises with available credit
 *     description: |
 *       Public endpoint — no authentication required.
 *       Returns all active franchises including their current credit balance
 *       so buyers can see which vendors have capacity to fulfil purchases.
 *     responses:
 *       200:
 *         description: Franchise list returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 franchises:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       businessName:
 *                         type: string
 *                       businessDescription:
 *                         type: string
 *                       creditBalance:
 *                         type: number
 *                         description: Available credit in Naira — shows buying capacity
 *                       totalSales:
 *                         type: number
 *                       vendor:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           username:
 *                             type: string
 *                       bankDetails:
 *                         type: object
 */
router.get('/list', fc.listFranchises);   // ← no protect

/**
 * @swagger
 * /franchise/{franchiseId}/detail:
 *   get:
 *     tags: [Franchise - Public]
 *     summary: Get franchise detail
 *     description: Full details of a franchise including bank details for payment.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: franchiseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Franchise detail returned
 *       404:
 *         description: Franchise not found or inactive
 */
router.get('/:franchiseId/detail', protect, fc.getFranchiseDetail);


// ─── Franchise Vendor — Account ───────────────────────────────────────────────

/**
 * @swagger
 * /franchise/register:
 *   post:
 *     tags: [Franchise - Vendor]
 *     summary: Register as a franchise vendor and submit first credit purchase
 *     description: |
 *       Single step to become a franchise reseller. Submit your business details,
 *       choose a credit package, and upload your payment proof all at once.
 *
 *       - Franchise account is created and set to **ACTIVE immediately** (no admin approval needed)
 *       - The credit purchase is submitted for admin approval separately
 *       - Once admin approves the payment, credit is added to your balance and you can start selling
 *
 *       **Packages:**
 *       - `starter`:    pay ₦800k → get ₦1M credit
 *       - `standard`:   pay ₦1.5M → get ₦2M credit
 *       - `pro`:        pay ₦2M   → get ₦3M credit
 *       - `enterprise`: pay ₦5M   → get ₦8M credit
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [businessName, bankName, accountNumber, accountName, packageKey, paymentProof]
 *             properties:
 *               businessName:
 *                 type: string
 *                 example: "John's Share Hub"
 *               businessDescription:
 *                 type: string
 *                 example: "Trusted AfriMobile share reseller in Lagos"
 *               bankName:
 *                 type: string
 *                 example: "First Bank"
 *               accountNumber:
 *                 type: string
 *                 example: "0123456789"
 *               accountName:
 *                 type: string
 *                 example: "John Doe"
 *               packageKey:
 *                 type: string
 *                 enum: [starter, standard, pro, enterprise]
 *                 example: "starter"
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *                 default: "bank_transfer"
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image/PDF (max 5MB)
 *     responses:
 *       201:
 *         description: Franchise created and credit purchase submitted for admin approval
 *       400:
 *         description: Already registered, missing fields, or invalid package
 */
router.post('/register',
  protect,
  sharePaymentUpload.single('paymentProof'),
  fc.registerFranchise
);

/**
 * @swagger
 * /franchise/my-profile:
 *   get:
 *     tags: [Franchise - Vendor]
 *     summary: Get my franchise profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile returned
 *       404:
 *         description: No franchise found
 */
router.get('/my-profile', protect, fc.getMyFranchise);

/**
 * @swagger
 * /franchise/bank-details:
 *   put:
 *     tags: [Franchise - Vendor]
 *     summary: Update bank details
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bankName, accountNumber, accountName]
 *             properties:
 *               bankName:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *               accountName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bank details updated
 */
router.put('/bank-details', protect, fc.updateBankDetails);

/**
 * @swagger
 * /franchise/available-tiers:
 *   get:
 *     tags: [Franchise - Vendor]
 *     summary: Get available share tiers for self-purchase
 *     description: Returns all active share tiers that a franchise can buy using their credit balance.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available tiers returned
 */
/**
 * @swagger
 * /franchise/available-tiers:
 *   get:
 *     tags: [Franchise - Vendor]
 *     summary: Get available share tiers for self-purchase
 *     description: Returns all active share tiers that a franchise can buy using their credit balance.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available tiers returned
 */
router.get('/available-tiers', protect, async (req, res) => {
  try {
    const TierConfig = require('../models/TierConfig');
    const config = await TierConfig.getCurrentConfig();
    
    const tiers = [];
    
    // ✅ Alternative: Get all keys from the Map
    const tierKeys = config.tiers.keys ? Array.from(config.tiers.keys()) : Object.keys(config.tiers.toObject?.() || {});
    
    for (const key of tierKeys) {
      // Skip internal Mongoose keys
      if (key.startsWith('$')) continue;
      
      // Get the tier data
      let tier;
      if (config.tiers.get) {
        tier = config.tiers.get(key);
      } else {
        tier = config.tiers[key];
      }
      
      if (!tier || tier.active === false) continue;
      
      // Convert to plain object if needed
      const tierObj = tier.toObject ? tier.toObject() : tier;
      
      const tierType = tierObj.type === 'cofounder' ? 'co-founder' : 'share';
      
      if (tierType === 'share' || tierObj.type === 'regular') {
        tiers.push({
          tierKey: key,
          label: tierObj.name,
          priceNaira: tierObj.priceNGN,
          priceUSD: tierObj.priceUSD,
          shares: tierObj.sharesIncluded || 1,
          percentPerShare: tierObj.percentPerShare,
          earningPerPhone: tierObj.earningPerPhone,
          description: tierObj.description || '',
          type: 'share'
        });
      } else if (tierType === 'co-founder' || tierObj.type === 'cofounder') {
        tiers.push({
          tierKey: key,
          label: tierObj.name,
          priceNaira: tierObj.priceNGN,
          priceUSD: tierObj.priceUSD,
          shares: tierObj.sharesIncluded || 1,
          percentPerShare: tierObj.percentPerShare,
          cofounderPercent: tierObj.percentPerShare,
          earningPerPhone: tierObj.earningPerPhone,
          description: tierObj.description || '',
          type: 'co-founder'
        });
      }
    }
    
    tiers.sort((a, b) => a.priceNaira - b.priceNaira);
    res.json({ success: true, tiers });
  } catch (err) {
    console.error('Error fetching available tiers:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});
// ─── Franchise Vendor — Credit (top up reseller credit) ──────────────────────

/**
 * @swagger
 * /franchise/buy-credit:
 *   post:
 *     tags: [Franchise - Vendor Credit]
 *     summary: Top up franchise credit (existing franchises only)
 *     description: |
 *       For existing active franchises that want to buy more credit after their initial package.
 *       Upload payment proof → admin approves → credit added to balance.
 *
 *       **Packages:**
 *       - `starter`:    pay ₦800k → get ₦1M credit
 *       - `standard`:   pay ₦1.5M → get ₦2M credit
 *       - `pro`:        pay ₦2M   → get ₦3M credit
 *       - `enterprise`: pay ₦5M   → get ₦8M credit
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [packageKey, paymentProof]
 *             properties:
 *               packageKey:
 *                 type: string
 *                 enum: [starter, standard, pro, enterprise]
 *                 example: "starter"
 *               paymentMethod:
 *                 type: string
 *                 enum: [bank_transfer, cash, other]
 *                 default: "bank_transfer"
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment proof image/PDF (max 5MB)
 *     responses:
 *       200:
 *         description: Credit top-up submitted for admin approval
 *       400:
 *         description: Invalid package or missing proof
 *       403:
 *         description: Must be an active franchise (use /register if new)
 */
router.post('/buy-credit',
  protect,
  sharePaymentUpload.single('paymentProof'),
  fc.buyCredit
);


// ─── Franchise Vendor — Sales Management ─────────────────────────────────────

/**
 * @swagger
 * /franchise/my-sales:
 *   get:
 *     tags: [Franchise - Vendor Sales]
 *     summary: View all buyer transactions through my franchise
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, disputed, resolved_buyer, resolved_vendor]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Sales list returned
 */
router.get('/my-sales', protect, fc.getMySales);

/**
 * @swagger
 * /franchise/self-purchase:
 *   post:
 *     tags: [Franchise - Vendor Sales]
 *     summary: Buy shares for yourself using your credit balance
 *     description: |
 *       The franchise owner uses their own credit balance to buy shares for their
 *       own portfolio. No payment proof needed — credit is deducted immediately.
 *       No referral commissions are processed.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tierKey]
 *             properties:
 *               tierKey:
 *                 type: string
 *                 description: Company tier key (e.g. 'basic', 'standard')
 *                 example: "basic"
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 default: "naira"
 *     responses:
 *       200:
 *         description: Shares purchased and added to your portfolio
 *       400:
 *         description: Insufficient credit or invalid tier
 *       403:
 *         description: Active franchise required
 */
router.post('/self-purchase', protect, fc.selfPurchase);

/**
 * @swagger
 * /franchise/approve/{transactionId}:
 *   put:
 *     tags: [Franchise - Vendor Sales]
 *     summary: Approve a buyer's payment
 *     description: |
 *       Confirms the buyer's payment was received. This will:
 *       - Deduct `companyPrice` from your franchise credit balance
 *       - Release shares to the buyer's portfolio
 *       - Send the buyer a confirmation email
 *
 *       **You must have sufficient credit balance to approve.**
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "FRT-A1B2C3D4-123456"
 *     responses:
 *       200:
 *         description: Payment approved, shares released
 *       400:
 *         description: Insufficient credit or wrong status
 *       403:
 *         description: Active franchise required
 *       404:
 *         description: Transaction not found
 */
router.put('/approve/:transactionId', protect, fc.approveTransaction);

/**
 * @swagger
 * /franchise/reject/{transactionId}:
 *   put:
 *     tags: [Franchise - Vendor Sales]
 *     summary: Reject a buyer's payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Payment amount incorrect"
 *     responses:
 *       200:
 *         description: Transaction rejected
 *       400:
 *         description: Cannot reject non-pending transaction
 */
router.put('/reject/:transactionId', protect, fc.rejectTransaction);


// ─── Buyer ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /franchise/{franchiseId}/buy:
 *   post:
 *     tags: [Franchise - Buyer]
 *     summary: Buy shares through a franchise
 *     description: |
 *       Buyer selects a company share tier, pays the franchise at company price,
 *       and uploads proof. The franchise vendor reviews and approves the payment.
 *
 *       **Important:**
 *       - Price is always the company's listed price — no markup
 *       - No referral commissions are earned on franchise purchases
 *       - You can only have one pending transaction per franchise at a time
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: franchiseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [tierKey, paymentProof]
 *             properties:
 *               tierKey:
 *                 type: string
 *                 description: Company share tier key
 *                 example: "basic"
 *               currency:
 *                 type: string
 *                 enum: [naira, usdt]
 *                 default: "naira"
 *               buyerNote:
 *                 type: string
 *                 example: "Transfer ref: ABC123"
 *               paymentProof:
 *                 type: string
 *                 format: binary
 *                 description: Payment receipt (image/PDF, max 5MB)
 *     responses:
 *       201:
 *         description: Purchase submitted, awaiting vendor approval
 *       400:
 *         description: Invalid tier, insufficient franchise credit, or pending transaction exists
 *       404:
 *         description: Franchise not found or inactive
 */
router.post('/:franchiseId/buy',
  protect,
  sharePaymentUpload.single('paymentProof'),
  fc.buyFromFranchise
);

/**
 * @swagger
 * /franchise/my-purchases:
 *   get:
 *     tags: [Franchise - Buyer]
 *     summary: Get my purchases through franchises
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Purchase history returned
 */
router.get('/my-purchases', protect, fc.getMyPurchases);

/**
 * @swagger
 * /franchise/dispute/{transactionId}:
 *   post:
 *     tags: [Franchise - Buyer]
 *     summary: Raise a dispute on a franchise purchase
 *     description: If you paid but the franchise hasn't approved, raise a dispute for admin review.
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
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "I paid ₦50,000 but vendor has not responded in 48 hours"
 *     responses:
 *       200:
 *         description: Dispute raised
 *       400:
 *         description: Cannot dispute this transaction status
 */
router.post('/dispute/:transactionId', protect, fc.raiseDispute);

/**
 * @swagger
 * /franchise/proof/{transactionId}:
 *   get:
 *     tags: [Franchise - Buyer]
 *     summary: View payment proof for a transaction
 *     description: Buyer, vendor, or admin can view the payment proof uploaded for a transaction.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: string
 *           enum: ["true"]
 *         description: Pass redirect=true to get redirected directly to the Cloudinary URL
 *     responses:
 *       200:
 *         description: Proof URL returned
 *       302:
 *         description: Redirect to Cloudinary (when redirect=true)
 *       403:
 *         description: Access denied
 *       404:
 *         description: No proof on file
 */
router.get('/proof/:transactionId', protect, fc.getPaymentProof);


// ─── Admin ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /franchise/admin/list:
 *   get:
 *     tags: [Franchise - Admin]
 *     summary: List all franchises
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, suspended, revoked]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Franchise list returned
 */
router.get('/admin/list', protect, adminProtect, fc.adminListFranchises);

/**
 * @swagger
 * /franchise/admin/stats:
 *   get:
 *     tags: [Franchise - Admin]
 *     summary: Dashboard statistics
 *     description: Overview of all franchises, credit totals, and transaction counts.
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Stats returned
 */
router.get('/admin/stats', protect, adminProtect, fc.adminStats);

/**
 * @swagger
 * /franchise/admin/transactions:
 *   get:
 *     tags: [Franchise - Admin]
 *     summary: Get all franchise transactions
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected, disputed, resolved_buyer, resolved_vendor]
 *       - in: query
 *         name: franchiseId
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Transactions returned
 */
router.get('/admin/transactions', protect, adminProtect, fc.adminGetTransactions);

/**
 * @swagger
 * /franchise/admin/credit/pending:
 *   get:
 *     tags: [Franchise - Admin Credit]
 *     summary: Get all pending credit purchases
 *     description: All franchise credit purchases awaiting admin approval.
 *     security:
 *       - adminAuth: []
 *     responses:
 *       200:
 *         description: Pending credit purchases returned
 */
router.get('/admin/credit/pending', protect, adminProtect, fc.adminGetPendingCredits);

/**
 * @swagger
 * /franchise/admin/{franchiseId}/status:
 *   put:
 *     tags: [Franchise - Admin]
 *     summary: Suspend or revoke a franchise
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: franchiseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, suspended, revoked]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 */
router.put('/admin/:franchiseId/status', protect, adminProtect, fc.adminUpdateStatus);

/**
 * @swagger
 * /franchise/admin/credit/{franchiseId}/approve/{transactionId}:
 *   put:
 *     tags: [Franchise - Admin Credit]
 *     summary: Approve a franchise credit purchase
 *     description: |
 *       Approves the franchise's payment and adds the credit to their balance.
 *       The franchise can then use this credit to approve buyer purchases.
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: franchiseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Credit approved and balance updated
 *       400:
 *         description: Already processed
 *       404:
 *         description: Franchise or purchase not found
 */
router.put('/admin/credit/:franchiseId/approve/:transactionId', protect, adminProtect, fc.adminApproveCredit);

/**
 * @swagger
 * /franchise/admin/credit/{franchiseId}/reject/{transactionId}:
 *   put:
 *     tags: [Franchise - Admin Credit]
 *     summary: Reject a franchise credit purchase
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: franchiseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adminNote:
 *                 type: string
 *                 example: "Payment proof unclear, please resubmit"
 *     responses:
 *       200:
 *         description: Credit purchase rejected
 */
router.put('/admin/credit/:franchiseId/reject/:transactionId', protect, adminProtect, fc.adminRejectCredit);

/**
 * @swagger
 * /franchise/admin/adjust-credit/{franchiseId}:
 *   post:
 *     tags: [Franchise - Admin Credit]
 *     summary: Manually adjust franchise credit balance
 *     description: Add or deduct credit from a franchise's balance (e.g. for corrections or bonuses).
 *     security:
 *       - adminAuth: []
 *     parameters:
 *       - in: path
 *         name: franchiseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, type]
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 500000
 *               type:
 *                 type: string
 *                 enum: [add, deduct]
 *                 example: "add"
 *               reason:
 *                 type: string
 *                 example: "Bonus for top franchise"
 *     responses:
 *       200:
 *         description: Credit adjusted
 *       400:
 *         description: Deduction exceeds balance or invalid params
 */
router.post('/admin/adjust-credit/:franchiseId', protect, adminProtect, fc.adminAdjustCredit);

/**
 * @swagger
 * /franchise/admin/resolve-dispute/{transactionId}:
 *   put:
 *     tags: [Franchise - Admin]
 *     summary: Resolve a buyer dispute
 *     description: |
 *       Admin reviews the dispute and decides in favour of buyer or vendor.
 *
 *       - **Favor buyer** (`favorBuyer: true`): shares are released to buyer,
 *         credit is deducted from franchise (if available).
 *       - **Favor vendor** (`favorBuyer: false`): transaction marked as vendor win,
 *         no shares released.
 *     security:
 *       - adminAuth: []
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
 *             required: [favorBuyer]
 *             properties:
 *               favorBuyer:
 *                 type: boolean
 *                 example: true
 *               resolution:
 *                 type: string
 *                 example: "Buyer provided bank statement confirming transfer"
 *               adminNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute resolved
 *       400:
 *         description: Transaction not in disputed status
 */
router.put('/admin/resolve-dispute/:transactionId', protect, adminProtect, fc.adminResolveDispute);

module.exports = router;