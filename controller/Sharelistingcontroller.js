const ShareListing = require('../models/Sharelisting');
const SharePurchaseOffer = require('../models/Sharepurchaseoffer');
const SharePercentageOffer = require('../models/SharePercentageListing');
const ShareTransferRecord = require('../models/Sharetransferrecord');
const SharePercentageListing = require('../models/SharePercentageListing');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const Share = require('../models/Share');
const AdminAuditLog = require('../models/AdminAuditLog');
const { sendEmail } = require('../utils/emailService');
const axios = require('axios');
const crypto = require('crypto');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper: Log admin action to audit trail
 */
const logAdminAction = async (adminId, action, targetId, targetType, details, reason = '') => {
  try {
    const auditLog = new AdminAuditLog({
      adminId,
      action,
      targetId,
      targetType,
      details,
      reason,
      timestamp: new Date(),
      ipAddress: '' // Add from request if needed
    });
    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error('Error logging admin action:', error);
  }
};

/**
 * Helper: Send notification to user
 */
const notifyUser = async (userId, subject, message, transactionId) => {
  try {
    const user = await User.findById(userId);
    if (user && user.email) {
      await sendEmail({
        email: user.email,
        subject,
        html: message
      });
    }
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

// ============================================================================
// SHARE LISTING FUNCTIONS (ORIGINAL)
// ============================================================================

/**
 * @desc    Create a new share listing (seller listing shares for sale)
 * @route   POST /api/shares/listings
 * @access  Private (User)
 */
exports.createShareListing = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      shares,
      shareType = 'regular',
      pricePerShare,
      currency,
      paymentMethods,
      bankDetails = null,
      cryptoWallet = null,
      description,
      minSharesPerBuy = 1,
      maxSharesPerBuyer = null,
      expiresIn = 30, // Days
      requiresBuyerVerification = false,
      isPublic = true
    } = req.body;

    // Validate required fields
    if (!shares || !pricePerShare || !currency || !paymentMethods) {
      return res.status(400).json({
        success: false,
        message: 'Please provide shares, price per share, currency, and payment methods'
      });
    }

    // Verify user has enough shares to list
    const userShares = await UserShare.findOne({ user: userId });
    if (!userShares) {
      return res.status(400).json({
        success: false,
        message: 'No share records found for this user'
      });
    }

    // Check share balance based on type
    const availableShares = shareType === 'cofounder'
      ? userShares.transactions
        .filter(t => t.paymentMethod === 'co-founder' && t.status === 'completed')
        .reduce((sum, t) => sum + (t.coFounderShares || t.shares || 0), 0)
      : userShares.transactions
        .filter(t => t.paymentMethod !== 'co-founder' && t.status === 'completed')
        .reduce((sum, t) => sum + (t.shares || 0), 0);

    if (availableShares < shares) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${shareType} shares. You have ${availableShares} available`,
        available: availableShares,
        requested: shares
      });
    }

    // Validate payment methods and details
    for (const method of paymentMethods) {
      if (method === 'bank_transfer' && !bankDetails) {
        return res.status(400).json({
          success: false,
          message: 'Bank details required for bank transfer payments'
        });
      }
      if ((method === 'crypto' || method === 'wallet_transfer') && !cryptoWallet) {
        return res.status(400).json({
          success: false,
          message: 'Crypto wallet details required for crypto payments'
        });
      }
    }

    // Create listing
    const listingId = ShareListing.generateListingId();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresIn);

    const listing = new ShareListing({
      listingId,
      seller: userId,
      shares,
      shareType,
      pricePerShare,
      currency,
      totalPrice: shares * pricePerShare,
      paymentMethods,
      bankDetails: paymentMethods.includes('bank_transfer') ? bankDetails : null,
      cryptoWallet: (paymentMethods.includes('crypto') || paymentMethods.includes('wallet_transfer'))
        ? cryptoWallet : null,
      description,
      minSharesPerBuy,
      maxSharesPerBuyer,
      expiresAt,
      requiresBuyerVerification,
      isPublic
    });

    await listing.save();

    // Notify user
    const user = await User.findById(userId);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: 'Share Listing Created Successfully',
          html: `
            <h2>Your Share Listing is Live</h2>
            <p>Your listing for ${shares} ${shareType} shares at ${currency === 'naira' ? '₦' : '$'}${pricePerShare} per share is now active.</p>
            <p>Listing ID: ${listingId}</p>
            <p>Total Value: ${currency === 'naira' ? '₦' : '$'}${listing.totalPrice}</p>
            <p>Your listing will expire on ${expiresAt.toLocaleDateString()}</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending listing confirmation email:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Share listing created successfully',
      listing: {
        listingId: listing.listingId,
        shares: listing.shares,
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        status: listing.status,
        expiresAt: listing.expiresAt,
        paymentMethods: listing.paymentMethods
      }
    });

  } catch (error) {
    console.error('Error creating share listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create share listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all active share listings (public marketplace)
 * @route   GET /api/shares/listings
 * @access  Public
 */
exports.getShareListings = async (req, res) => {
  try {
    const { currency, shareType, minPrice, maxPrice, page = 1, limit = 20, search } = req.query;

    const query = {
      status: 'active',
      expiresAt: { $gt: new Date() },
      isPublic: true
    };

    if (currency) query.currency = currency;
    if (shareType) query.shareType = shareType;
    if (minPrice) query.pricePerShare = { $gte: parseInt(minPrice) };
    if (maxPrice) {
      query.pricePerShare = { ...query.pricePerShare, $lte: parseInt(maxPrice) };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await ShareListing.find(query)
      .populate('seller', 'name username avatar rating reviews')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await ShareListing.countDocuments(query);

    res.status(200).json({
      success: true,
      listings: listings.map(listing => ({
        listingId: listing.listingId,
        shares: listing.shares,
        sharesAvailable: listing.sharesAvailable,
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        shareType: listing.shareType,
        paymentMethods: listing.paymentMethods,
        seller: {
          id: listing.seller._id,
          name: listing.seller.name,
          username: listing.seller.username,
          avatar: listing.seller.avatar,
          rating: listing.seller.rating,
          reviews: listing.seller.reviews
        },
        description: listing.description,
        minSharesPerBuy: listing.minSharesPerBuy,
        createdAt: listing.createdAt,
        expiresAt: listing.expiresAt,
        views: listing.views
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching share listings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get a specific share listing
 * @route   GET /api/shares/listings/:listingId
 * @access  Public
 */
exports.getShareListing = async (req, res) => {
  try {
    const { listingId } = req.params;

    const listing = await ShareListing.findOne({ listingId })
      .populate('seller', 'name username avatar rating reviews email phone');

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Increment views
    listing.views += 1;
    await listing.save();

    res.status(200).json({
      success: true,
      listing: {
        listingId: listing.listingId,
        shares: listing.shares,
        sharesAvailable: listing.sharesAvailable,
        sharesSold: listing.sharesSold,
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        shareType: listing.shareType,
        paymentMethods: listing.paymentMethods,
        bankDetails: listing.paymentMethods.includes('bank_transfer') ? listing.bankDetails : null,
        cryptoWallet: (listing.paymentMethods.includes('crypto') || listing.paymentMethods.includes('wallet_transfer'))
          ? listing.cryptoWallet : null,
        seller: {
          id: listing.seller._id,
          name: listing.seller.name,
          username: listing.seller.username,
          avatar: listing.seller.avatar,
          rating: listing.seller.rating,
          reviews: listing.seller.reviews,
          email: listing.seller.email,
          phone: listing.seller.phone
        },
        description: listing.description,
        minSharesPerBuy: listing.minSharesPerBuy,
        maxSharesPerBuyer: listing.maxSharesPerBuyer,
        requiresBuyerVerification: listing.requiresBuyerVerification,
        createdAt: listing.createdAt,
        expiresAt: listing.expiresAt,
        views: listing.views,
        isExpired: listing.isExpired()
      }
    });

  } catch (error) {
    console.error('Error fetching share listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Create a purchase offer for a listing
 * @route   POST /api/shares/listings/:listingId/offer
 * @access  Private (User)
 */
exports.createPurchaseOffer = async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { listingId } = req.params;
    const { shares, paymentMethod, buyerNote } = req.body;

    // Find listing
    const listing = await ShareListing.findOne({ listingId });
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Validate purchase
    if (!listing.canBuy(shares)) {
      return res.status(400).json({
        success: false,
        message: shares > listing.sharesAvailable
          ? `Only ${listing.sharesAvailable} shares available`
          : `Minimum purchase is ${listing.minSharesPerBuy} shares`
      });
    }

    if (!listing.paymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Payment method not available for this listing'
      });
    }

    // Check buyer doesn't exceed max per buyer limit
    if (listing.maxSharesPerBuyer) {
      const existingPurchases = await SharePurchaseOffer.countDocuments({
        listing: listing._id,
        buyer: buyerId,
        status: { $in: ['accepted', 'in_payment', 'completed'] }
      });
      
      const existingShares = await ShareTransferRecord.aggregate([
        {
          $match: {
            toUser: buyerId,
            listing: listing._id,
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$shareCount' }
          }
        }
      ]);

      const totalShares = (existingShares[0]?.total || 0) + shares;
      if (totalShares > listing.maxSharesPerBuyer) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${listing.maxSharesPerBuyer} shares per buyer. You would have ${totalShares}`
        });
      }
    }

    // Prevent seller from buying own listing
    if (listing.seller.toString() === buyerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot purchase your own listing'
      });
    }

    // Create offer
    const offerId = SharePurchaseOffer.generateOfferId();
    const totalPrice = shares * listing.pricePerShare;

    const offer = new SharePurchaseOffer({
      offerId,
      seller: listing.seller,
      buyer: buyerId,
      listing: listing._id,
      shares,
      pricePerShare: listing.pricePerShare,
      currency: listing.currency,
      totalPrice,
      paymentMethod,
      buyerNote
    });

    await offer.save();

    // Notify seller
    const seller = await User.findById(listing.seller);
    if (seller && seller.email) {
      try {
        await sendEmail({
          email: seller.email,
          subject: 'New Purchase Offer for Your Shares',
          html: `
            <h2>New Purchase Offer</h2>
            <p>Someone is interested in purchasing ${shares} shares from your listing.</p>
            <p>Total: ${listing.currency === 'naira' ? '₦' : '$'}${totalPrice}</p>
            <p>Price per share: ${listing.currency === 'naira' ? '₦' : '$'}${listing.pricePerShare}</p>
            <p>Offer ID: ${offerId}</p>
            <p>Please review and respond within 24 hours.</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending offer notification:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Purchase offer created successfully',
      offer: {
        offerId: offer.offerId,
        shares: offer.shares,
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        paymentMethod: offer.paymentMethod,
        status: offer.status,
        expiresAt: offer.expiresAt
      }
    });

  } catch (error) {
    console.error('Error creating purchase offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create purchase offer',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Accept a purchase offer (seller accepts buyer's offer)
 * @route   POST /api/shares/offers/:offerId/accept
 * @access  Private (User - Seller)
 */
exports.acceptPurchaseOffer = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { offerId } = req.params;
    const { sellerNote } = req.body;

    // Find offer
    const offer = await SharePurchaseOffer.findOne({ offerId })
      .populate('seller')
      .populate('buyer')
      .populate('listing');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Verify seller
    if (offer.seller._id.toString() !== sellerId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only the seller can accept this offer'
      });
    }

    // Check offer is pending
    if (offer.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Offer already ${offer.status}`
      });
    }

    // Update offer
    offer.status = 'accepted';
    offer.sellerNote = sellerNote;
    offer.sellerConfirmed = true;
    offer.acceptedAt = new Date();
    
    // Set payment deadline (48 hours from now)
    const paymentDeadline = new Date();
    paymentDeadline.setHours(paymentDeadline.getHours() + 48);
    offer.paymentDeadline = paymentDeadline;

    await offer.save();

    // Notify buyer to proceed with payment
    const buyer = await User.findById(offer.buyer);
    if (buyer && buyer.email) {
      try {
        await sendEmail({
          email: buyer.email,
          subject: 'Your Share Purchase Offer Has Been Accepted!',
          html: `
            <h2>Offer Accepted</h2>
            <p>Great news! Your offer to purchase ${offer.shares} shares has been accepted.</p>
            <p>Total Amount Due: ${offer.currency === 'naira' ? '₦' : '$'}${offer.totalPrice}</p>
            <p>Payment Method: ${offer.paymentMethod}</p>
            <p>Payment Deadline: ${paymentDeadline.toLocaleDateString()}</p>
            <p>Offer ID: ${offerId}</p>
            <p>Please complete payment as soon as possible.</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending acceptance notification:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Purchase offer accepted',
      offer: {
        offerId: offer.offerId,
        status: offer.status,
        paymentDeadline: offer.paymentDeadline
      }
    });

  } catch (error) {
    console.error('Error accepting purchase offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept offer',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Submit payment for a share purchase
 * @route   POST /api/shares/offers/:offerId/payment
 * @access  Private (User - Buyer)
 */
exports.submitPaymentForShare = async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { offerId } = req.params;
    const {
      transactionReference,
      bankTransferDetails = null,
      cryptoTransferDetails = null,
      paymentProofDescription = null
    } = req.body;

    // Find offer
    const offer = await SharePurchaseOffer.findOne({ offerId })
      .populate('seller')
      .populate('buyer')
      .populate('listing');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Verify buyer
    if (offer.buyer._id.toString() !== buyerId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only the buyer can submit payment'
      });
    }

    // Check offer is accepted
    if (offer.status !== 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Offer must be accepted before payment'
      });
    }

    // Check deadline hasn't passed
    if (new Date() > offer.paymentDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Payment deadline has passed'
      });
    }

    // Handle payment proof upload (if file provided)
    let paymentProofData = null;
    if (req.file) {
      paymentProofData = {
        cloudinaryUrl: req.file.path,
        cloudinaryId: req.file.filename,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        format: req.file.format,
        uploadedAt: new Date()
      };
    }

    // Update offer with payment details
    offer.status = 'in_payment';
    offer.paymentStatus = 'processing';
    offer.transactionReference = transactionReference;
    offer.paymentProof = paymentProofData;

    if (offer.paymentMethod === 'bank_transfer' && bankTransferDetails) {
      offer.bankTransferDetails = bankTransferDetails;
    }

    if ((offer.paymentMethod === 'crypto' || offer.paymentMethod === 'wallet_transfer') && cryptoTransferDetails) {
      offer.cryptoTransferDetails = cryptoTransferDetails;
    }

    await offer.save();

    // Notify seller of payment submission
    const seller = await User.findById(offer.seller);
    if (seller && seller.email) {
      try {
        await sendEmail({
          email: seller.email,
          subject: 'Payment Received for Your Shares',
          html: `
            <h2>Payment Submitted</h2>
            <p>The buyer has submitted payment for ${offer.shares} shares.</p>
            <p>Amount: ${offer.currency === 'naira' ? '₦' : '$'}${offer.totalPrice}</p>
            <p>Transaction Reference: ${transactionReference}</p>
            <p>Please verify the payment and confirm receipt.</p>
            <p>Offer ID: ${offerId}</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending payment notification:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Payment submitted successfully. Awaiting seller verification.',
      offer: {
        offerId: offer.offerId,
        status: offer.status,
        paymentStatus: offer.paymentStatus,
        transactionReference: offer.transactionReference
      }
    });

  } catch (error) {
    console.error('Error submitting payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Confirm payment received and complete share transfer
 * @route   POST /api/shares/offers/:offerId/confirm-payment
 * @access  Private (User - Seller)
 */
exports.confirmPaymentAndTransfer = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { offerId } = req.params;
    const { sellerNote } = req.body;

    // Find offer
    const offer = await SharePurchaseOffer.findOne({ offerId })
      .populate('seller')
      .populate('buyer')
      .populate('listing');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Verify seller
    if (offer.seller._id.toString() !== sellerId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only the seller can confirm payment'
      });
    }

    // Check payment was submitted
    if (offer.status !== 'in_payment') {
      return res.status(400).json({
        success: false,
        message: 'Payment must be submitted before confirmation'
      });
    }

    // Start transaction for data consistency
    const session = await require('mongoose').startSession();
    session.startTransaction();

    try {
      // 1. Transfer shares from seller to buyer
      const transferId = ShareTransferRecord.generateTransferId();

      const transferRecord = new ShareTransferRecord({
        transferId,
        fromUser: offer.seller._id,
        toUser: offer.buyer._id,
        transferType: 'sale',
        shareCount: offer.shares,
        shareType: offer.listing.shareType,
        pricePerShare: offer.pricePerShare,
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        offer: offer._id,
        listing: offer.listing._id,
        status: 'in_progress',
        paymentVerified: true,
        paymentVerificationDetails: {
          verifiedBy: sellerId,
          verificationMethod: 'manual_review',
          verificationProof: `Payment verified by seller for ${offer.paymentMethod}`,
          verifiedAt: new Date()
        }
      });

      await transferRecord.save({ session });

      // 2. Update seller's share balance (deduct sold shares)
      const sellerShares = await UserShare.findOne({ user: offer.seller._id }).session(session);
      if (sellerShares) {
        // Mark the sold shares in seller's transactions
        for (let i = 0; i < sellerShares.transactions.length && offer.shares > 0; i++) {
          const tx = sellerShares.transactions[i];
          if ((tx.shareType === offer.listing.shareType || !tx.shareType) && 
              tx.status === 'completed' && 
              !tx.sold) {
            
            const sharesFromTx = Math.min(offer.shares, tx.shares || 0);
            offer.shares -= sharesFromTx;
            
            // Update transaction to mark shares as listed/sold
            tx.sold = (tx.sold || 0) + sharesFromTx;
          }
        }
        
        await sellerShares.save({ session });
      }

      // 3. Add shares to buyer
      let buyerShares = await UserShare.findOne({ user: offer.buyer._id }).session(session);
      if (!buyerShares) {
        buyerShares = new UserShare({ user: offer.buyer._id, transactions: [] });
      }

      buyerShares.transactions.push({
        transactionId: transferRecord._id.toString(),
        shares: offer.shares,
        pricePerShare: offer.pricePerShare,
        currency: offer.currency,
        totalAmount: offer.totalPrice,
        paymentMethod: 'share_transfer',
        status: 'completed',
        shareTransferFrom: offer.seller._id,
        shareType: offer.listing.shareType,
        tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 }
      });

      buyerShares.totalShares = buyerShares.transactions
        .filter(t => t.status === 'completed')
        .reduce((sum, t) => sum + (t.shares || 0), 0);

      await buyerShares.save({ session });

      // 4. Update listing status
      offer.listing.sharesSold += offer.shares;
      if (offer.listing.sharesSold >= offer.listing.shares) {
        offer.listing.status = 'sold';
        offer.listing.completedAt = new Date();
      } else if (offer.listing.sharesSold > 0) {
        offer.listing.status = 'partially_sold';
      }

      await offer.listing.save({ session });

      // 5. Update offer status
      offer.status = 'completed';
      offer.paymentStatus = 'completed';
      offer.shareTransferStatus = 'transferred';
      offer.completedAt = new Date();

      await offer.save({ session });

      // Commit transaction
      await session.commitTransaction();

      // Send confirmation emails
      try {
        await sendEmail({
          email: offer.buyer.email,
          subject: 'Share Transfer Complete!',
          html: `
            <h2>Transfer Complete</h2>
            <p>You have successfully purchased ${offer.shares} shares!</p>
            <p>Shares are now in your account.</p>
            <p>Transfer ID: ${transferId}</p>
          `
        });

        await sendEmail({
          email: offer.seller.email,
          subject: 'Share Sale Complete!',
          html: `
            <h2>Sale Complete</h2>
            <p>You have successfully sold ${offer.shares} shares for ${offer.currency === 'naira' ? '₦' : '$'}${offer.totalPrice}.</p>
            <p>Payment has been confirmed.</p>
            <p>Transfer ID: ${transferId}</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending completion emails:', emailError);
      }

      res.status(200).json({
        success: true,
        message: 'Payment confirmed and shares transferred successfully',
        transfer: {
          transferId: transferRecord.transferId,
          shares: offer.shares,
          status: transferRecord.status,
          completedAt: offer.completedAt
        }
      });

    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm payment and transfer shares',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's active share listings
 * @route   GET /api/shares/my-listings
 * @access  Private (User)
 */
exports.getUserListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { seller: userId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await ShareListing.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await ShareListing.countDocuments(query);

    res.status(200).json({
      success: true,
      listings: listings.map(listing => ({
        listingId: listing.listingId,
        shares: listing.shares,
        sharesAvailable: listing.sharesAvailable,
        sharesSold: listing.sharesSold,
        pricePerShare: listing.pricePerShare,
        totalPrice: listing.totalPrice,
        currency: listing.currency,
        status: listing.status,
        paymentMethods: listing.paymentMethods,
        views: listing.views,
        createdAt: listing.createdAt,
        expiresAt: listing.expiresAt,
        isExpired: listing.isExpired()
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching user listings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Cancel a share listing
 * @route   POST /api/shares/listings/:listingId/cancel
 * @access  Private (User - Seller)
 */
exports.cancelShareListing = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listingId } = req.params;
    const { cancelReason } = req.body;

    const listing = await ShareListing.findOne({ listingId });

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Verify ownership
    if (listing.seller.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Only the seller can cancel this listing'
      });
    }

    // Check status
    if (listing.status === 'sold' || listing.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${listing.status} listing`
      });
    }

    // Update listing
    listing.status = 'cancelled';
    listing.cancelledAt = new Date();
    listing.cancelReason = cancelReason || 'Cancelled by seller';

    await listing.save();

    // Cancel any pending offers
    await SharePurchaseOffer.updateMany(
      { listing: listing._id, status: 'pending' },
      { status: 'cancelled', cancelReason: 'Listing was cancelled' }
    );

    res.status(200).json({
      success: true,
      message: 'Listing cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Decline a purchase offer
 * @route   POST /api/shares/offers/:offerId/decline
 * @access  Private (User - Seller)
 */
exports.declinePurchaseOffer = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { offerId } = req.params;
    const { reason } = req.body;

    const offer = await SharePurchaseOffer.findOne({ offerId })
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Verify seller
    if (offer.seller.toString() !== sellerId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot decline an ${offer.status} offer`
      });
    }

    // Update offer
    offer.status = 'cancelled';
    offer.cancelReason = reason || 'Declined by seller';
    offer.cancelledAt = new Date();

    await offer.save();

    // Notify buyer
    const buyer = await User.findById(offer.buyer);
    if (buyer && buyer.email) {
      try {
        await sendEmail({
          email: buyer.email,
          subject: 'Your Share Purchase Offer Was Declined',
          html: `
            <h2>Offer Declined</h2>
            <p>Unfortunately, the seller has declined your offer.</p>
            <p>Reason: ${reason || 'No reason provided'}</p>
            <p>You may try again or look for other listings.</p>
          `
        });
      } catch (emailError) {
        console.error('Error sending decline notification:', emailError);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Offer declined successfully'
    });

  } catch (error) {
    console.error('Error declining offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to decline offer',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's purchase offers (sent and received)
 * @route   GET /api/shares/offers
 * @access  Private (User)
 */
exports.getUserOffers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'all', status, page = 1, limit = 20 } = req.query;

    let query = {};

    // Filter by type (sent/received/all)
    if (type === 'sent') {
      query.buyer = userId;
    } else if (type === 'received') {
      query.seller = userId;
    } else {
      query.$or = [{ buyer: userId }, { seller: userId }];
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const offers = await SharePurchaseOffer.find(query)
      .populate('seller', 'name username avatar email')
      .populate('buyer', 'name username avatar email')
      .populate('listing', 'listingId shareType pricePerShare currency')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await SharePurchaseOffer.countDocuments(query);

    res.status(200).json({
      success: true,
      offers: offers.map(offer => ({
        offerId: offer.offerId,
        shares: offer.shares,
        pricePerShare: offer.pricePerShare,
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        paymentMethod: offer.paymentMethod,
        status: offer.status,
        paymentStatus: offer.paymentStatus,
        type: offer.buyer._id.toString() === userId ? 'sent' : 'received',
        seller: {
          id: offer.seller._id,
          name: offer.seller.name,
          username: offer.seller.username,
          avatar: offer.seller.avatar
        },
        buyer: {
          id: offer.buyer._id,
          name: offer.buyer.name,
          username: offer.buyer.username,
          avatar: offer.buyer.avatar
        },
        listing: {
          listingId: offer.listing.listingId,
          shareType: offer.listing.shareType
        },
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
        paymentDeadline: offer.paymentDeadline
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching user offers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get share transfer history
 * @route   GET /api/shares/transfer-history
 * @access  Private (User)
 */
exports.getTransferHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    const query = {
      $or: [
        { fromUser: userId },
        { toUser: userId }
      ]
    };

    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transfers = await ShareTransferRecord.find(query)
      .populate('fromUser', 'name username avatar email')
      .populate('toUser', 'name username avatar email')
      .populate('listing', 'listingId')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await ShareTransferRecord.countDocuments(query);

    res.status(200).json({
      success: true,
      transfers: transfers.map(transfer => ({
        transferId: transfer.transferId,
        transferType: transfer.transferType,
        shareCount: transfer.shareCount,
        shareType: transfer.shareType,
        pricePerShare: transfer.pricePerShare,
        totalPrice: transfer.totalPrice,
        currency: transfer.currency,
        status: transfer.status,
        direction: transfer.fromUser._id.toString() === userId ? 'sent' : 'received',
        fromUser: {
          id: transfer.fromUser._id,
          name: transfer.fromUser.name,
          username: transfer.fromUser.username,
          avatar: transfer.fromUser.avatar
        },
        toUser: {
          id: transfer.toUser._id,
          name: transfer.toUser.name,
          username: transfer.toUser.username,
          avatar: transfer.toUser.avatar
        },
        listing: transfer.listing ? {
          listingId: transfer.listing.listingId
        } : null,
        paymentVerified: transfer.paymentVerified,
        createdAt: transfer.createdAt,
        completedAt: transfer.completedAt
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching transfer history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// PERCENTAGE-BASED LISTING FUNCTIONS
// ============================================================================

/**
 * @desc    Get user's holdings with tier breakdown
 * @route   GET /api/shares/percentage/my-holdings
 * @access  Private
 */
exports.getUserHoldingsByTier = async (req, res) => {
  try {
    const userId = req.user.id;

    const userShares = await UserShare.findOne({ user: userId });
    
    if (!userShares || !userShares.transactions || userShares.transactions.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          message: 'No shares found',
          tiers: {}
        }
      });
    }

    const tierConfig = Share.getTierConfig();

    // Group shares by tier
    const holdingsByTier = {};
    
    userShares.transactions.forEach(tx => {
      if (tx.status === 'completed') {
        const tier = tx.tier || 'standard';
        if (!holdingsByTier[tier]) {
          holdingsByTier[tier] = {
            shares: 0,
            percentage: 0
          };
        }
        
        const shares = tx.shares || 0;
        holdingsByTier[tier].shares += shares;
        
        if (tierConfig[tier]) {
          holdingsByTier[tier].percentage += shares * tierConfig[tier].percentPerShare;
        }
      }
    });

    // Get active listings per tier
    const activeListings = await SharePercentageListing.find({
      seller: userId,
      status: 'active'
    });

    const listedByTier = {};
    activeListings.forEach(listing => {
      if (!listedByTier[listing.tier]) {
        listedByTier[listing.tier] = 0;
      }
      listedByTier[listing.tier] += listing.percentageOfHoldings;
    });

    // Format response
    const formattedTiers = {};
    Object.keys(holdingsByTier).forEach(tier => {
      formattedTiers[tier] = {
        tierName: tierConfig[tier]?.name || 'Unknown',
        tierType: tierConfig[tier]?.type || 'unknown',
        shares: holdingsByTier[tier].shares,
        percentPerShare: tierConfig[tier]?.percentPerShare.toFixed(8) || 0,
        totalPercentage: holdingsByTier[tier].percentage.toFixed(6),
        listed: listedByTier[tier] || 0,
        available: Math.max(0, 100 - (listedByTier[tier] || 0)),
        priceNGN: tierConfig[tier]?.priceNGN || 0,
        priceUSD: tierConfig[tier]?.priceUSD || 0,
        earningPerPhone: tierConfig[tier]?.earningPerPhone || 0
      };
    });

    res.status(200).json({
      success: true,
      data: {
        tiers: formattedTiers,
        activeListings: activeListings.length
      }
    });

  } catch (error) {
    console.error('Error fetching user holdings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch holdings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Create percentage-based share listing
 * @route   POST /api/shares/percentage/listings
 * @access  Private
 */
exports.createPercentageListingTierBased = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      percentageOfHoldings,
      tier = 'standard',
      pricePerShare,
      currency,
      durationDays = 30,
      paymentMethods = ['bank_transfer'],
      description = '',
      minSharesPerBuy = 1,
      bankDetails = null,
      cryptoWallet = null
    } = req.body;

    // Validation
    if (!percentageOfHoldings || percentageOfHoldings <= 0 || percentageOfHoldings > 100) {
      return res.status(400).json({
        success: false,
        message: 'Percentage must be between 0 and 100'
      });
    }

    if (!pricePerShare || !currency) {
      return res.status(400).json({
        success: false,
        message: 'Price per share and currency are required'
      });
    }

    // Get user's shares
    const userShares = await UserShare.findOne({ user: userId });
    if (!userShares) {
      return res.status(400).json({
        success: false,
        message: 'No share records found'
      });
    }

    // Get tier configuration
    const tierConfig = Share.getTierConfig();
    
    if (!tierConfig[tier]) {
      return res.status(400).json({
        success: false,
        message: `Invalid tier. Valid tiers: ${Object.keys(tierConfig).join(', ')}`
      });
    }

    // Calculate total shares in this tier
    let totalSharesInTier = 0;
    userShares.transactions.forEach(tx => {
      if (tx.status === 'completed' && (tx.tier === tier || (!tx.tier && tier === 'standard'))) {
        totalSharesInTier += tx.shares || 0;
      }
    });

    if (totalSharesInTier === 0) {
      return res.status(400).json({
        success: false,
        message: `You have no ${tierConfig[tier].name} shares in your portfolio`
      });
    }

    // Calculate actual shares from percentage
    const actualShares = Math.floor((percentageOfHoldings / 100) * totalSharesInTier);

    if (actualShares === 0) {
      return res.status(400).json({
        success: false,
        message: `${percentageOfHoldings}% of your ${tierConfig[tier].name} shares equals less than 1 share. Please select a higher percentage.`
      });
    }

    // Calculate total percentage ownership represented
    const totalPercentageRepresented = actualShares * tierConfig[tier].percentPerShare;

    // Check listing limit
    const listingLimit = await SharePercentageListing.checkListingLimit(
      userId,
      tier,
      percentageOfHoldings
    );

    if (!listingLimit.canList) {
      return res.status(400).json({
        success: false,
        message: listingLimit.message,
        alreadyListed: listingLimit.alreadyListed,
        available: listingLimit.available
      });
    }

    // Create listing
    const listingId = SharePercentageListing.generateListingId();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const listing = new SharePercentageListing({
      listingId,
      seller: userId,
      percentageOfHoldings,
      percentageSold: 0,
      tier,
      tierName: tierConfig[tier].name,
      tierType: tierConfig[tier].type,
      totalSharesInTier,
      actualShares,
      sharesSold: 0,
      sharesAvailable: actualShares,
      percentPerShare: tierConfig[tier].percentPerShare,
      totalPercentageRepresented,
      pricePerShare,
      currency,
      totalPrice: actualShares * pricePerShare,
      durationDays,
      expiresAt,
      paymentMethods,
      bankDetails: paymentMethods.includes('bank_transfer') ? bankDetails : null,
      cryptoWallet: ['crypto', 'wallet_transfer'].some(m => paymentMethods.includes(m)) ? cryptoWallet : null,
      description,
      minSharesPerBuy,
      status: 'active'
    });

    await listing.save();

    const user = await User.findById(userId);
    if (user && user.email) {
      try {
        await sendEmail({
          email: user.email,
          subject: `${tierConfig[tier].name} Shares Listed on AfriMobile (${percentageOfHoldings}% of your holdings)`,
          html: `
            <h2>Share Listing Created Successfully</h2>
            <p>You have successfully listed <strong>${percentageOfHoldings}% of your ${tierConfig[tier].name} shares</strong>.</p>
            <ul>
              <li><strong>Tier:</strong> ${tierConfig[tier].name}</li>
              <li><strong>Your total in this tier:</strong> ${totalSharesInTier.toLocaleString()} shares</li>
              <li><strong>Actual shares offered:</strong> ${actualShares.toLocaleString()} shares</li>
              <li><strong>Total ownership represented:</strong> ${totalPercentageRepresented.toFixed(6)}%</li>
              <li><strong>Total listing value:</strong> ${currency === 'naira' ? '₦' : '$'}${(actualShares * pricePerShare).toLocaleString()}</li>
              <li><strong>Duration:</strong> ${durationDays} days</li>
              <li><strong>Expires:</strong> ${expiresAt.toLocaleDateString()}</li>
            </ul>
          `
        });
      } catch (emailError) {
        console.error('Error sending listing email:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Percentage listing created successfully',
      listing: {
        listingId: listing.listingId,
        tier: listing.tier,
        tierName: listing.tierName,
        tierType: listing.tierType,
        percentageOfHoldings: listing.percentageOfHoldings,
        actualShares: listing.actualShares,
        totalSharesInTier: listing.totalSharesInTier,
        percentPerShare: listing.percentPerShare.toFixed(8),
        totalPercentageRepresented: listing.totalPercentageRepresented.toFixed(6),
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        durationDays: listing.durationDays,
        expiresAt: listing.expiresAt,
        status: listing.status
      }
    });

  } catch (error) {
    console.error('Error creating percentage listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all percentage-based listings
 * @route   GET /api/shares/percentage/listings
 * @access  Public
 */
exports.getPercentageListings = async (req, res) => {
  try {
    const { currency, tier, page = 1, limit = 20 } = req.query;

    const query = {
      status: 'active',
      expiresAt: { $gt: new Date() }
    };

    if (currency) query.currency = currency;
    if (tier) query.tier = tier;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await SharePercentageListing.find(query)
      .populate('seller', 'name username avatar rating')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await SharePercentageListing.countDocuments(query);

    res.status(200).json({
      success: true,
      listings: listings.map(listing => ({
        listingId: listing.listingId,
        tier: listing.tier,
        tierName: listing.tierName,
        tierType: listing.tierType,
        percentageToSell: listing.percentageOfHoldings,
        percentageSold: listing.percentageSold,
        actualShares: listing.actualShares,
        totalShares: listing.totalSharesInTier,
        totalPercentage: listing.totalPercentageRepresented.toFixed(6),
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        durationDays: listing.durationDays,
        daysRemaining: Math.ceil((listing.expiresAt - new Date()) / (1000 * 60 * 60 * 24)),
        paymentMethods: listing.paymentMethods,
        seller: {
          id: listing.seller._id,
          name: listing.seller.name,
          username: listing.seller.username,
          avatar: listing.seller.avatar,
          rating: listing.seller.rating
        },
        createdAt: listing.createdAt,
        expiresAt: listing.expiresAt
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching percentage listings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get specific percentage listing
 * @route   GET /api/shares/percentage/listings/:listingId
 * @access  Public
 */
exports.getPercentageListing = async (req, res) => {
  try {
    const { listingId } = req.params;

    const listing = await SharePercentageListing.findOne({ listingId })
      .populate('seller', 'name username avatar rating email phone');

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    listing.views = (listing.views || 0) + 1;
    await listing.save();

    res.status(200).json({
      success: true,
      listing: {
        listingId: listing.listingId,
        tier: listing.tier,
        tierName: listing.tierName,
        tierType: listing.tierType,
        percentageToSell: listing.percentageOfHoldings,
        percentageSold: listing.percentageSold,
        actualShares: listing.actualShares,
        totalShares: listing.totalSharesInTier,
        totalPercentage: listing.totalPercentageRepresented.toFixed(6),
        percentPerShare: listing.percentPerShare.toFixed(8),
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        durationDays: listing.durationDays,
        daysRemaining: Math.ceil((listing.expiresAt - new Date()) / (1000 * 60 * 60 * 24)),
        paymentMethods: listing.paymentMethods,
        bankDetails: listing.paymentMethods.includes('bank_transfer') ? listing.bankDetails : null,
        cryptoWallet: ['crypto', 'wallet_transfer'].some(m => listing.paymentMethods.includes(m)) ? listing.cryptoWallet : null,
        seller: {
          id: listing.seller._id,
          name: listing.seller.name,
          username: listing.seller.username,
          avatar: listing.seller.avatar,
          rating: listing.seller.rating,
          email: listing.seller.email,
          phone: listing.seller.phone
        },
        description: listing.description,
        views: listing.views,
        createdAt: listing.createdAt,
        expiresAt: listing.expiresAt,
        isExpired: listing.expiresAt < new Date()
      }
    });

  } catch (error) {
    console.error('Error fetching percentage listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's percentage listings
 * @route   GET /api/shares/percentage/my-listings
 * @access  Private
 */
exports.getUserPercentageListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, tier, page = 1, limit = 20 } = req.query;

    const query = { seller: userId };
    if (status) query.status = status;
    if (tier) query.tier = tier;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await SharePercentageListing.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await SharePercentageListing.countDocuments(query);

    res.status(200).json({
      success: true,
      listings: listings.map(listing => ({
        listingId: listing.listingId,
        tier: listing.tier,
        tierName: listing.tierName,
        percentageToSell: listing.percentageOfHoldings,
        percentageSold: listing.percentageSold,
        actualShares: listing.actualShares,
        totalShares: listing.totalSharesInTier,
        totalPercentage: listing.totalPercentageRepresented.toFixed(6),
        pricePerShare: listing.pricePerShare,
        currency: listing.currency,
        totalPrice: listing.totalPrice,
        status: listing.status,
        durationDays: listing.durationDays,
        daysRemaining: Math.ceil((listing.expiresAt - new Date()) / (1000 * 60 * 60 * 24)),
        paymentMethods: listing.paymentMethods,
        views: listing.views,
        createdAt: listing.createdAt,
        expiresAt: listing.expiresAt,
        isExpired: listing.expiresAt < new Date()
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching user percentage listings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Make offer on percentage listing
 * @route   POST /api/shares/percentage/listings/:listingId/offer
 * @access  Private
 */
exports.makePercentageOffer = async (req, res) => {
  try {
    const buyerId = req.user.id;
    const { listingId } = req.params;
    const { percentageToOffer, paymentMethod } = req.body;

    if (!percentageToOffer || percentageToOffer <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid percentage'
      });
    }

    const listing = await SharePercentageListing.findOne({ listingId });
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    const availablePercentage = listing.percentageOfHoldings - listing.percentageSold;
    if (percentageToOffer > availablePercentage) {
      return res.status(400).json({
        success: false,
        message: `Only ${availablePercentage.toFixed(2)}% available`
      });
    }

    const sharesToOffer = Math.floor((percentageToOffer / 100) * listing.totalSharesInTier);
    const percentageOffered = sharesToOffer * listing.percentPerShare;
    const totalPrice = sharesToOffer * listing.pricePerShare;

    const offerId = `POF-${listing.tier}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const offer = new SharePercentageOffer({
      offerId,
      seller: listing.seller,
      buyer: buyerId,
      listing: listing._id,
      tier: listing.tier,
      percentageToOffer,
      sharesToOffer,
      percentageOffered,
      pricePerShare: listing.pricePerShare,
      currency: listing.currency,
      totalPrice,
      paymentMethod,
      status: 'pending'
    });

    await offer.save();

    res.status(201).json({
      success: true,
      message: 'Offer created successfully',
      offer: {
        offerId: offer.offerId,
        tier: offer.tier,
        percentageToOffer: offer.percentageToOffer,
        sharesToOffer: offer.sharesToOffer,
        percentageOffered: offer.percentageOffered.toFixed(6),
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        status: offer.status
      }
    });

  } catch (error) {
    console.error('Error making percentage offer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create offer',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get user's percentage-based sales history
 * @route   GET /api/shares/percentage/sales-history
 * @access  Private
 */
exports.getPercentageSalesHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, tier } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {
      fromUser: userId,
      transferType: 'percentage_sale'
    };

    if (tier) query.tier = tier;

    const transfers = await ShareTransferRecord.find(query)
      .populate('toUser', 'name username avatar')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await ShareTransferRecord.countDocuments(query);

    const totalSalesData = await ShareTransferRecord.aggregate([
      { $match: { fromUser: userId, transferType: 'percentage_sale', status: 'completed' } },
      { $group: { 
        _id: null, 
        totalShares: { $sum: '$shareCount' },
        totalValue: { $sum: '$totalPrice' },
        totalPercentage: { $sum: '$percentageSold' }
      }}
    ]);

    res.status(200).json({
      success: true,
      salesHistory: transfers.map(transfer => ({
        transferId: transfer.transferId,
        tier: transfer.tier,
        shares: transfer.shareCount,
        percentage: transfer.percentageSold.toFixed(6),
        pricePerShare: transfer.pricePerShare,
        totalPrice: transfer.totalPrice,
        currency: transfer.currency,
        status: transfer.status,
        buyer: {
          name: transfer.toUser.name,
          username: transfer.toUser.username,
          avatar: transfer.toUser.avatar
        },
        createdAt: transfer.createdAt,
        completedAt: transfer.completedAt
      })),
      totalStats: {
        totalShares: totalSalesData[0]?.totalShares || 0,
        totalValue: totalSalesData[0]?.totalValue || 0,
        totalPercentage: (totalSalesData[0]?.totalPercentage || 0).toFixed(6)
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching sales history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - DASHBOARD & MONITORING
// ============================================================================

/**
 * @desc    Get transaction dashboard overview
 * @route   GET /api/admin/transactions/dashboard
 * @access  Private (Admin only)
 */
exports.getDashboard = async (req, res) => {
  try {
    const adminId = req.user.id;

    // Get summary statistics
    const totalOffers = await SharePurchaseOffer.countDocuments();
    const completedToday = await SharePurchaseOffer.countDocuments({
      status: 'completed',
      completedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });
    const pendingOffers = await SharePurchaseOffer.countDocuments({ status: 'pending' });
    const inPaymentOffers = await SharePurchaseOffer.countDocuments({ status: 'in_payment' });

    // Get stuck transactions (in_payment for more than 48 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckOffers = await SharePurchaseOffer.find({
      status: 'in_payment',
      acceptedAt: { $lt: oneDayAgo }
    }).populate('seller', 'name email').populate('buyer', 'name email').populate('listing', 'listingId');

    // Get percentage offers stuck
    const stuckPercentageOffers = await SharePercentageOffer.find({
      status: 'in_payment',
      acceptedAt: { $lt: oneDayAgo }
    }).populate('seller', 'name email').populate('buyer', 'name email');

    // Calculate total values
    const offerAggregation = await SharePurchaseOffer.aggregate([
      { $match: { status: 'completed' } },
      { $group: {
        _id: '$currency',
        total: { $sum: '$totalPrice' }
      }}
    ]);

    const valueSummary = {
      naira: 0,
      usdt: 0
    };
    offerAggregation.forEach(item => {
      if (item._id === 'naira') valueSummary.naira = item.total;
      if (item._id === 'usdt') valueSummary.usdt = item.total;
    });

    // Get recent transactions
    const recentTransactions = await SharePurchaseOffer.find()
      .populate('seller', 'name username')
      .populate('buyer', 'name username')
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalTransactions: totalOffers,
          completedToday,
          pendingTransactions: pendingOffers,
          inPaymentTransactions: inPaymentOffers,
          stuckTransactions: stuckOffers.length + stuckPercentageOffers.length,
          totalValueNaira: valueSummary.naira,
          totalValueUSDT: valueSummary.usdt
        },
        stuckTransactions: [
          ...stuckOffers.map(offer => ({
            id: offer._id,
            offerId: offer.offerId,
            type: 'share_offer',
            shares: offer.shares,
            amount: offer.totalPrice,
            currency: offer.currency,
            seller: offer.seller.name,
            buyer: offer.buyer.name,
            acceptedAt: offer.acceptedAt,
            hoursStuck: Math.floor((Date.now() - offer.acceptedAt) / (1000 * 60 * 60))
          })),
          ...stuckPercentageOffers.map(offer => ({
            id: offer._id,
            offerId: offer.offerId,
            type: 'percentage_offer',
            percentage: offer.percentageToOffer,
            amount: offer.totalPrice,
            currency: offer.currency,
            seller: offer.seller.name,
            buyer: offer.buyer.name,
            acceptedAt: offer.acceptedAt,
            hoursStuck: Math.floor((Date.now() - offer.acceptedAt) / (1000 * 60 * 60))
          }))
        ],
        recentTransactions: recentTransactions.map(t => ({
          id: t._id,
          offerId: t.offerId,
          shares: t.shares,
          seller: t.seller.name,
          buyer: t.buyer.name,
          status: t.status,
          createdAt: t.createdAt
        }))
      }
    });

    // Log dashboard access
    await logAdminAction(adminId, 'dashboard_access', null, 'system', {
      action: 'viewed_dashboard'
    });

  } catch (error) {
    console.error('Error getting dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all transactions with filters
 * @route   GET /api/admin/transactions/all
 * @access  Private (Admin only)
 */
exports.getAllTransactions = async (req, res) => {
  try {
    const { status, type, days = 30, page = 1, limit = 50, search } = req.query;

    const query = {};
    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - parseInt(days));
    query.createdAt = { $gte: dateFilter };

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { offerId: new RegExp(search, 'i') }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let transactions = [];
    let total = 0;

    // Get share purchase offers
    const offers = await SharePurchaseOffer.find(query)
      .populate('seller', 'name username email')
      .populate('buyer', 'name username email')
      .populate('listing', 'listingId shares')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    total = await SharePurchaseOffer.countDocuments(query);

    transactions = offers.map(offer => ({
      id: offer._id,
      transactionId: offer.offerId,
      type: 'share_offer',
      status: offer.status,
      seller: {
        id: offer.seller._id,
        name: offer.seller.name,
        email: offer.seller.email
      },
      buyer: {
        id: offer.buyer._id,
        name: offer.buyer.name,
        email: offer.buyer.email
      },
      shares: offer.shares,
      amount: offer.totalPrice,
      currency: offer.currency,
      paymentMethod: offer.paymentMethod,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
      acceptedAt: offer.acceptedAt,
      paymentDeadline: offer.paymentDeadline
    }));

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get transaction details
 * @route   GET /api/admin/transactions/:transactionId
 * @access  Private (Admin only)
 */
exports.getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Try to find in SharePurchaseOffer first
    let transaction = await SharePurchaseOffer.findById(transactionId)
      .populate('seller', 'name username email phone avatar')
      .populate('buyer', 'name username email phone avatar')
      .populate('listing', 'listingId shares pricePerShare')
      .populate('offer');

    if (!transaction) {
      // Try SharePercentageOffer
      transaction = await SharePercentageOffer.findById(transactionId)
        .populate('seller', 'name username email phone avatar')
        .populate('buyer', 'name username email phone avatar')
        .populate('listing', 'listingId percentageOfHoldings');

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found'
        });
      }
    }

    // Get transfer record if completed
    const transfer = await ShareTransferRecord.findOne({
      offer: transaction._id,
      status: 'completed'
    });

    res.status(200).json({
      success: true,
      transaction: {
        id: transaction._id,
        transactionId: transaction.offerId,
        type: transaction.shares ? 'share_offer' : 'percentage_offer',
        seller: {
          id: transaction.seller._id,
          name: transaction.seller.name,
          email: transaction.seller.email,
          phone: transaction.seller.phone,
          avatar: transaction.seller.avatar
        },
        buyer: {
          id: transaction.buyer._id,
          name: transaction.buyer.name,
          email: transaction.buyer.email,
          phone: transaction.buyer.phone,
          avatar: transaction.buyer.avatar
        },
        details: {
          shares: transaction.shares || null,
          percentage: transaction.percentageToOffer || null,
          pricePerShare: transaction.pricePerShare,
          totalPrice: transaction.totalPrice,
          currency: transaction.currency,
          paymentMethod: transaction.paymentMethod
        },
        status: transaction.status,
        paymentStatus: transaction.paymentStatus,
        createdAt: transaction.createdAt,
        acceptedAt: transaction.acceptedAt,
        paymentDeadline: transaction.paymentDeadline,
        completedAt: transaction.completedAt,
        transfer: transfer ? {
          transferId: transfer.transferId,
          status: transfer.status,
          completedAt: transfer.completedAt
        } : null,
        timeline: {
          created: transaction.createdAt,
          accepted: transaction.acceptedAt,
          paymentDeadline: transaction.paymentDeadline,
          completed: transaction.completedAt
        }
      }
    });

  } catch (error) {
    console.error('Error getting transaction details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - STUCK TRANSACTIONS
// ============================================================================

/**
 * @desc    Get stuck transactions
 * @route   GET /api/admin/transactions/stuck/list
 * @access  Private (Admin only)
 */
exports.getStuckTransactions = async (req, res) => {
  try {
    const { hoursStuck = 24, page = 1, limit = 50 } = req.query;

    const stuckTime = new Date(Date.now() - hoursStuck * 60 * 60 * 1000);
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const stuckOffers = await SharePurchaseOffer.find({
      status: 'in_payment',
      acceptedAt: { $lt: stuckTime }
    })
      .populate('seller', 'name email')
      .populate('buyer', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ acceptedAt: 1 });

    const total = await SharePurchaseOffer.countDocuments({
      status: 'in_payment',
      acceptedAt: { $lt: stuckTime }
    });

    const stuckTransactions = stuckOffers.map(offer => ({
      id: offer._id,
      offerId: offer.offerId,
      type: 'share_offer',
      seller: { name: offer.seller.name, email: offer.seller.email },
      buyer: { name: offer.buyer.name, email: offer.buyer.email },
      shares: offer.shares,
      amount: offer.totalPrice,
      currency: offer.currency,
      acceptedAt: offer.acceptedAt,
      hoursStuck: Math.floor((Date.now() - offer.acceptedAt) / (1000 * 60 * 60)),
      daysStuck: Math.floor((Date.now() - offer.acceptedAt) / (1000 * 60 * 60 * 24))
    }));

    res.status(200).json({
      success: true,
      stuckTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error getting stuck transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stuck transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Flag transaction as stuck
 * @route   POST /api/admin/transactions/:transactionId/flag-stuck
 * @access  Private (Admin only)
 */
exports.flagTransactionAsStuck = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { reason, adminNotes } = req.body;

    const offer = await SharePurchaseOffer.findById(transactionId)
      .populate('seller')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Update transaction
    offer.status = 'disputed';
    offer.disputeReason = reason;
    offer.adminNotes = adminNotes;
    offer.flaggedAt = new Date();
    offer.flaggedBy = adminId;
    await offer.save();

    // Log action
    await logAdminAction(
      adminId,
      'flag_stuck_transaction',
      transactionId,
      'transaction',
      { reason, adminNotes }
    );

    // Notify both parties
    await notifyUser(
      offer.seller._id,
      'Transaction Flagged as Stuck',
      `Your transaction ${offer.offerId} has been flagged as stuck and is under admin review.`,
      transactionId
    );

    await notifyUser(
      offer.buyer._id,
      'Transaction Flagged as Stuck',
      `Your transaction ${offer.offerId} has been flagged as stuck and is under admin review.`,
      transactionId
    );

    res.status(200).json({
      success: true,
      message: 'Transaction flagged as stuck',
      transaction: {
        id: offer._id,
        offerId: offer.offerId,
        status: offer.status,
        flaggedAt: offer.flaggedAt
      }
    });

  } catch (error) {
    console.error('Error flagging stuck transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to flag transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - FORCE COMPLETE TRANSACTION
// ============================================================================

/**
 * @desc    Force complete a transaction
 * @route   POST /api/admin/transactions/:transactionId/force-complete
 * @access  Private (Admin only)
 */
exports.forceCompleteTransaction = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { adminReason, adminNotes, verificationProof } = req.body;

    if (!adminReason) {
      return res.status(400).json({
        success: false,
        message: 'Admin reason is required for force completion'
      });
    }

    const offer = await SharePurchaseOffer.findById(transactionId)
      .populate('seller')
      .populate('buyer')
      .populate('listing');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (offer.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Transaction already completed'
      });
    }

    // Start database transaction
    const session = await require('mongoose').startSession();
    session.startTransaction();

    try {
      // 1. Create transfer record
      const transferId = ShareTransferRecord.generateTransferId();
      const transferRecord = new ShareTransferRecord({
        transferId,
        fromUser: offer.seller._id,
        toUser: offer.buyer._id,
        transferType: 'admin_forced_sale',
        shareCount: offer.shares,
        shareType: offer.listing.shareType,
        pricePerShare: offer.pricePerShare,
        totalPrice: offer.totalPrice,
        currency: offer.currency,
        offer: offer._id,
        listing: offer.listing._id,
        status: 'completed',
        adminForced: true,
        adminForcedBy: adminId,
        adminForcedReason: adminReason,
        adminNotes: adminNotes,
        verificationProof: verificationProof,
        paymentVerified: true,
        paymentVerificationDetails: {
          verifiedBy: adminId,
          verificationMethod: 'admin_forced',
          verificationProof: `Admin force completion: ${adminReason}`,
          verifiedAt: new Date()
        }
      });

      await transferRecord.save({ session });

      // 2. Update seller's share balance
      const sellerShares = await UserShare.findOne({ user: offer.seller._id }).session(session);
      if (sellerShares) {
        for (let i = 0; i < sellerShares.transactions.length && offer.shares > 0; i++) {
          const tx = sellerShares.transactions[i];
          if ((tx.shareType === offer.listing.shareType || !tx.shareType) &&
            tx.status === 'completed' &&
            !tx.sold) {

            const sharesFromTx = Math.min(offer.shares, tx.shares || 0);
            offer.shares -= sharesFromTx;
            tx.sold = (tx.sold || 0) + sharesFromTx;
          }
        }
        await sellerShares.save({ session });
      }

      // 3. Add shares to buyer
      let buyerShares = await UserShare.findOne({ user: offer.buyer._id }).session(session);
      if (!buyerShares) {
        buyerShares = new UserShare({ user: offer.buyer._id, transactions: [] });
      }

      buyerShares.transactions.push({
        transactionId: transferRecord._id.toString(),
        shares: offer.shares,
        pricePerShare: offer.pricePerShare,
        currency: offer.currency,
        totalAmount: offer.totalPrice,
        paymentMethod: 'admin_forced_transfer',
        status: 'completed',
        shareTransferFrom: offer.seller._id,
        shareType: offer.listing.shareType,
        tierBreakdown: { tier1: 0, tier2: 0, tier3: 0 }
      });

      buyerShares.totalShares = buyerShares.transactions
        .filter(t => t.status === 'completed')
        .reduce((sum, t) => sum + (t.shares || 0), 0);

      await buyerShares.save({ session });

      // 4. Update listing status
      offer.listing.sharesSold += offer.shares;
      if (offer.listing.sharesSold >= offer.listing.shares) {
        offer.listing.status = 'sold';
        offer.listing.completedAt = new Date();
      } else if (offer.listing.sharesSold > 0) {
        offer.listing.status = 'partially_sold';
      }
      await offer.listing.save({ session });

      // 5. Update offer status
      offer.status = 'completed';
      offer.paymentStatus = 'completed';
      offer.shareTransferStatus = 'transferred';
      offer.completedAt = new Date();
      offer.adminForcedCompletion = {
        by: adminId,
        reason: adminReason,
        notes: adminNotes,
        at: new Date()
      };
      await offer.save({ session });

      // Commit transaction
      await session.commitTransaction();

      // Log action
      await logAdminAction(
        adminId,
        'force_complete_transaction',
        transactionId,
        'transaction',
        {
          reason: adminReason,
          notes: adminNotes,
          shares: offer.shares,
          amount: offer.totalPrice
        }
      );

      // Send notifications
      await notifyUser(
        offer.seller._id,
        'Transaction Force Completed by Admin',
        `Your transaction ${offer.offerId} has been force completed by admin.<br>Reason: ${adminReason}<br>Amount: ${offer.totalPrice} ${offer.currency}`,
        transactionId
      );

      await notifyUser(
        offer.buyer._id,
        'Transaction Force Completed by Admin',
        `Your transaction ${offer.offerId} has been force completed by admin.<br>Reason: ${adminReason}<br>Shares have been transferred to your account.`,
        transactionId
      );

      res.status(200).json({
        success: true,
        message: 'Transaction force completed successfully',
        data: {
          transactionId: offer._id,
          offerId: offer.offerId,
          status: offer.status,
          transferId: transferRecord.transferId,
          completedAt: offer.completedAt,
          completedBy: adminId
        }
      });

    } catch (transactionError) {
      await session.abortTransaction();
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('Error force completing transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to force complete transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - CANCEL TRANSACTION
// ============================================================================

/**
 * @desc    Cancel a transaction
 * @route   POST /api/admin/transactions/:transactionId/cancel
 * @access  Private (Admin only)
 */
exports.cancelTransaction = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { reason, adminNotes, refundBuyer = true, refundAmount } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required'
      });
    }

    const offer = await SharePurchaseOffer.findById(transactionId)
      .populate('seller')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (offer.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed transaction. Use refund instead.'
      });
    }

    // Cancel the transaction
    offer.status = 'cancelled';
    offer.cancelledAt = new Date();
    offer.cancelledBy = adminId;
    offer.cancelReason = reason;
    offer.adminNotes = adminNotes;
    offer.adminCancelled = true;

    if (refundAmount) {
      offer.refundAmount = refundAmount;
    } else {
      offer.refundAmount = refundBuyer ? offer.totalPrice : 0;
    }

    await offer.save();

    // Log action
    await logAdminAction(
      adminId,
      'cancel_transaction',
      transactionId,
      'transaction',
      {
        reason,
        refundAmount: offer.refundAmount,
        notes: adminNotes
      }
    );

    // Send notifications
    const refundMsg = refundBuyer ? `A refund of ${offer.totalPrice} ${offer.currency} will be issued.` : '';
    await notifyUser(
      offer.seller._id,
      'Transaction Cancelled by Admin',
      `Your transaction ${offer.offerId} has been cancelled by admin.<br>Reason: ${reason}<br>${adminNotes ? `Notes: ${adminNotes}` : ''}`,
      transactionId
    );

    await notifyUser(
      offer.buyer._id,
      'Transaction Cancelled by Admin',
      `Your transaction ${offer.offerId} has been cancelled by admin.<br>Reason: ${reason}<br>${refundMsg}`,
      transactionId
    );

    res.status(200).json({
      success: true,
      message: 'Transaction cancelled successfully',
      data: {
        transactionId: offer._id,
        offerId: offer.offerId,
        status: offer.status,
        cancelledAt: offer.cancelledAt,
        refundAmount: offer.refundAmount
      }
    });

  } catch (error) {
    console.error('Error cancelling transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - DELETE TRANSACTION
// ============================================================================

/**
 * @desc    Delete a transaction
 * @route   DELETE /api/admin/transactions/:transactionId/delete
 * @access  Private (Admin only)
 */
exports.deleteTransaction = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { confirmDeletion, reason, adminNotes, notifyUsers = true } = req.body;

    // Confirm deletion
    if (!confirmDeletion) {
      return res.status(400).json({
        success: false,
        message: 'Deletion must be confirmed. Set confirmDeletion to true.'
      });
    }

    const offer = await SharePurchaseOffer.findById(transactionId)
      .populate('seller')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Can only delete cancelled or failed transactions
    if (!['cancelled', 'failed'].includes(offer.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete ${offer.status} transactions. Only cancelled or failed transactions can be deleted.`
      });
    }

    const offerId = offer.offerId;
    const seller = offer.seller;
    const buyer = offer.buyer;

    // Delete the transaction
    await SharePurchaseOffer.findByIdAndDelete(transactionId);

    // Log action (before deletion for reference)
    await logAdminAction(
      adminId,
      'delete_transaction',
      transactionId,
      'transaction',
      {
        offerId,
        reason,
        sellerName: seller.name,
        buyerName: buyer.name,
        notes: adminNotes
      },
      `Deleted transaction ${offerId}`
    );

    // Send notifications if requested
    if (notifyUsers) {
      await notifyUser(
        seller._id,
        'Transaction Deleted by Admin',
        `Transaction ${offerId} has been permanently deleted from the system.<br>Reason: ${reason}`,
        transactionId
      );

      await notifyUser(
        buyer._id,
        'Transaction Deleted by Admin',
        `Transaction ${offerId} has been permanently deleted from the system.<br>Reason: ${reason}`,
        transactionId
      );
    }

    res.status(200).json({
      success: true,
      message: 'Transaction deleted permanently',
      data: {
        transactionId,
        offerId,
        deletedAt: new Date(),
        deletedBy: adminId
      }
    });

  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete transaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - PROCESS REFUND
// ============================================================================

/**
 * @desc    Process refund for transaction
 * @route   POST /api/admin/transactions/:transactionId/refund
 * @access  Private (Admin only)
 */
exports.processRefund = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { amount, reason, method = 'original_payment', adminNotes } = req.body;

    const offer = await SharePurchaseOffer.findById(transactionId)
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const refundAmount = amount || offer.totalPrice;

    // Create refund record
    offer.refunded = true;
    offer.refundAmount = refundAmount;
    offer.refundMethod = method;
    offer.refundReason = reason;
    offer.refundedAt = new Date();
    offer.refundedBy = adminId;
    offer.adminNotes = adminNotes;
    await offer.save();

    // Log action
    await logAdminAction(
      adminId,
      'process_refund',
      transactionId,
      'transaction',
      {
        amount: refundAmount,
        method,
        reason,
        notes: adminNotes
      }
    );

    // Send notification
    await notifyUser(
      offer.buyer._id,
      'Refund Processed',
      `A refund of ${refundAmount} ${offer.currency} has been processed for transaction ${offer.offerId}.<br>Method: ${method}<br>Reason: ${reason}`,
      transactionId
    );

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        transactionId: offer._id,
        offerId: offer.offerId,
        refundAmount,
        refundMethod: method,
        refundedAt: offer.refundedAt,
        refundedBy: adminId
      }
    });

  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process refund',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - DISPUTE MANAGEMENT
// ============================================================================

/**
 * @desc    Create dispute for transaction
 * @route   POST /api/admin/transactions/:transactionId/create-dispute
 * @access  Private (Admin only)
 */
exports.createDispute = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { reason, adminNotes } = req.body;

    const offer = await SharePurchaseOffer.findById(transactionId);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    offer.status = 'disputed';
    offer.disputeReason = reason;
    offer.disputeCreatedAt = new Date();
    offer.disputeCreatedBy = adminId;
    offer.adminNotes = adminNotes;
    await offer.save();

    // Log action
    await logAdminAction(
      adminId,
      'create_dispute',
      transactionId,
      'transaction',
      { reason, notes: adminNotes }
    );

    res.status(200).json({
      success: true,
      message: 'Dispute created',
      data: {
        transactionId: offer._id,
        offerId: offer.offerId,
        status: 'disputed',
        disputeCreatedAt: offer.disputeCreatedAt
      }
    });

  } catch (error) {
    console.error('Error creating dispute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create dispute',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Resolve dispute
 * @route   POST /api/admin/transactions/:transactionId/resolve-dispute
 * @access  Private (Admin only)
 */
exports.resolveDispute = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { decision, reason, adminNotes } = req.body;

    if (!['award_buyer', 'award_seller', 'mediation', 'refund'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid decision. Must be: award_buyer, award_seller, mediation, or refund'
      });
    }

    const offer = await SharePurchaseOffer.findById(transactionId)
      .populate('seller')
      .populate('buyer');

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Apply decision
    switch (decision) {
      case 'award_buyer':
        // Refund buyer, cancel transaction
        offer.status = 'cancelled';
        offer.refunded = true;
        offer.refundAmount = offer.totalPrice;
        break;

      case 'award_seller':
        // Complete transaction, release funds
        offer.status = 'completed';
        offer.completedAt = new Date();
        break;

      case 'mediation':
        // Partial refund
        offer.status = 'completed';
        offer.refunded = true;
        offer.refundAmount = offer.totalPrice * 0.5; // 50% refund
        break;

      case 'refund':
        // Full refund
        offer.status = 'cancelled';
        offer.refunded = true;
        offer.refundAmount = offer.totalPrice;
        break;
    }

    offer.disputeResolution = {
      decision,
      resolvedBy: adminId,
      resolvedAt: new Date(),
      reason,
      notes: adminNotes
    };

    await offer.save();

    // Log action
    await logAdminAction(
      adminId,
      'resolve_dispute',
      transactionId,
      'transaction',
      { decision, reason, notes: adminNotes }
    );

    // Send notifications
    const decisionMsg = {
      award_buyer: 'The dispute has been resolved in your favor. A full refund will be issued.',
      award_seller: 'The dispute has been resolved in favor of the seller. Transaction will be completed.',
      mediation: 'The dispute has been resolved through mediation. A 50% refund will be issued.',
      refund: 'The dispute has been resolved with a full refund.'
    };

    await notifyUser(
      offer.buyer._id,
      'Dispute Resolved',
      `Dispute for transaction ${offer.offerId} has been resolved.<br>${decisionMsg[decision]}`,
      transactionId
    );

    await notifyUser(
      offer.seller._id,
      'Dispute Resolved',
      `Dispute for transaction ${offer.offerId} has been resolved.`,
      transactionId
    );

    res.status(200).json({
      success: true,
      message: 'Dispute resolved',
      data: {
        transactionId: offer._id,
        offerId: offer.offerId,
        decision,
        status: offer.status,
        resolvedAt: offer.disputeResolution.resolvedAt
      }
    });

  } catch (error) {
    console.error('Error resolving dispute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve dispute',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - STATUS UPDATE
// ============================================================================

/**
 * @desc    Update transaction status manually
 * @route   PATCH /api/admin/transactions/:transactionId/update-status
 * @access  Private (Admin only)
 */
exports.updateTransactionStatus = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionId } = req.params;
    const { newStatus, reason, adminNotes } = req.body;

    const offer = await SharePurchaseOffer.findById(transactionId);

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const oldStatus = offer.status;
    offer.status = newStatus;
    offer.statusUpdatedAt = new Date();
    offer.statusUpdatedBy = adminId;
    offer.statusUpdateReason = reason;
    offer.adminNotes = adminNotes;
    await offer.save();

    // Log action
    await logAdminAction(
      adminId,
      'update_transaction_status',
      transactionId,
      'transaction',
      { oldStatus, newStatus, reason, notes: adminNotes }
    );

    res.status(200).json({
      success: true,
      message: 'Transaction status updated',
      data: {
        transactionId: offer._id,
        offerId: offer.offerId,
        oldStatus,
        newStatus: offer.status,
        updatedAt: offer.statusUpdatedAt
      }
    });

  } catch (error) {
    console.error('Error updating transaction status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update transaction status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - AUDIT LOGS
// ============================================================================

/**
 * @desc    Get transaction audit log
 * @route   GET /api/admin/transactions/:transactionId/audit-log
 * @access  Private (Admin only)
 */
exports.getAuditLog = async (req, res) => {
  try {
    const { transactionId } = req.params;

    const logs = await AdminAuditLog.find({
      targetId: transactionId
    })
      .populate('adminId', 'name email')
      .sort({ timestamp: -1 });

    res.status(200).json({
      success: true,
      logs: logs.map(log => ({
        id: log._id,
        admin: log.adminId.name,
        action: log.action,
        details: log.details,
        reason: log.reason,
        timestamp: log.timestamp
      }))
    });

  } catch (error) {
    console.error('Error getting audit log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get audit log',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all admin actions audit log
 * @route   GET /api/admin/audit-logs
 * @access  Private (Admin only)
 */
exports.getAdminAuditLogs = async (req, res) => {
  try {
    const { admin, action, days = 30, page = 1, limit = 50 } = req.query;

    const query = {};
    const dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - parseInt(days));
    query.timestamp = { $gte: dateFilter };

    if (admin) query.adminId = admin;
    if (action) query.action = action;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const logs = await AdminAuditLog.find(query)
      .populate('adminId', 'name email')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ timestamp: -1 });

    const total = await AdminAuditLog.countDocuments(query);

    res.status(200).json({
      success: true,
      logs: logs.map(log => ({
        id: log._id,
        admin: log.adminId.name,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        reason: log.reason,
        timestamp: log.timestamp
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });

  } catch (error) {
    console.error('Error getting admin audit logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get audit logs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - BULK ACTIONS
// ============================================================================

/**
 * @desc    Bulk complete transactions
 * @route   POST /api/admin/transactions/bulk/complete
 * @access  Private (Admin only)
 */
exports.bulkCompleteTransactions = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionIds, reason, adminNotes } = req.body;

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transactionIds must be a non-empty array'
      });
    }

    const results = {
      completed: [],
      failed: []
    };

    for (const transactionId of transactionIds) {
      try {
        const offer = await SharePurchaseOffer.findById(transactionId);
        if (offer && offer.status !== 'completed') {
          offer.status = 'completed';
          offer.completedAt = new Date();
          offer.adminForcedCompletion = {
            by: adminId,
            reason,
            notes: adminNotes,
            at: new Date()
          };
          await offer.save();
          results.completed.push(offer.offerId);
        }
      } catch (error) {
        results.failed.push({ transactionId, error: error.message });
      }
    }

    // Log action
    await logAdminAction(
      adminId,
      'bulk_complete_transactions',
      null,
      'system',
      { count: results.completed.length, reason, notes: adminNotes }
    );

    res.status(200).json({
      success: true,
      message: 'Bulk completion completed',
      results
    });

  } catch (error) {
    console.error('Error bulk completing transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk complete transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Bulk cancel transactions
 * @route   POST /api/admin/transactions/bulk/cancel
 * @access  Private (Admin only)
 */
exports.bulkCancelTransactions = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { transactionIds, reason, adminNotes } = req.body;

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'transactionIds must be a non-empty array'
      });
    }

    const results = {
      cancelled: [],
      failed: []
    };

    for (const transactionId of transactionIds) {
      try {
        const offer = await SharePurchaseOffer.findById(transactionId);
        if (offer && offer.status !== 'completed') {
          offer.status = 'cancelled';
          offer.cancelledAt = new Date();
          offer.cancelledBy = adminId;
          offer.cancelReason = reason;
          offer.adminCancelled = true;
          offer.adminNotes = adminNotes;
          await offer.save();
          results.cancelled.push(offer.offerId);
        }
      } catch (error) {
        results.failed.push({ transactionId, error: error.message });
      }
    }

    // Log action
    await logAdminAction(
      adminId,
      'bulk_cancel_transactions',
      null,
      'system',
      { count: results.cancelled.length, reason, notes: adminNotes }
    );

    res.status(200).json({
      success: true,
      message: 'Bulk cancellation completed',
      results
    });

  } catch (error) {
    console.error('Error bulk cancelling transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk cancel transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// ADMIN FUNCTIONS - REPORTS
// ============================================================================

/**
 * @desc    Get daily transaction report
 * @route   GET /api/admin/transactions/reports/daily
 * @access  Private (Admin only)
 */
exports.getDailyReport = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const completed = await SharePurchaseOffer.countDocuments({
      status: 'completed',
      completedAt: { $gte: today }
    });

    const pending = await SharePurchaseOffer.countDocuments({
      status: 'pending',
      createdAt: { $gte: today }
    });

    const cancelled = await SharePurchaseOffer.countDocuments({
      status: 'cancelled',
      cancelledAt: { $gte: today }
    });

    const totalValue = await SharePurchaseOffer.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: today } } },
      { $group: {
        _id: '$currency',
        total: { $sum: '$totalPrice' }
      }}
    ]);

    res.status(200).json({
      success: true,
      report: {
        date: today,
        completed,
        pending,
        cancelled,
        totalValue: totalValue.reduce((acc, item) => {
          acc[item._id] = item.total;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Error getting daily report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get daily report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get stuck transactions report
 * @route   GET /api/admin/transactions/reports/stuck
 * @access  Private (Admin only)
 */
exports.getStuckTransactionsReport = async (req, res) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stuck = await SharePurchaseOffer.find({
      status: 'in_payment',
      acceptedAt: { $lt: oneDayAgo }
    })
      .populate('seller', 'name email')
      .populate('buyer', 'name email');

    const stuckByHours = {
      '24_48': stuck.filter(t => (Date.now() - t.acceptedAt) < 48 * 60 * 60 * 1000).length,
      '48_72': stuck.filter(t => (Date.now() - t.acceptedAt) >= 48 * 60 * 60 * 1000 && (Date.now() - t.acceptedAt) < 72 * 60 * 60 * 1000).length,
      '72_plus': stuck.filter(t => (Date.now() - t.acceptedAt) >= 72 * 60 * 60 * 1000).length
    };

    const totalValue = stuck.reduce((sum, t) => sum + t.totalPrice, 0);

    res.status(200).json({
      success: true,
      report: {
        totalStuck: stuck.length,
        stuckByHours,
        totalValueAtRisk: totalValue,
        transactions: stuck.map(t => ({
          offerId: t.offerId,
          seller: t.seller.name,
          buyer: t.buyer.name,
          amount: t.totalPrice,
          currency: t.currency,
          hoursStuck: Math.floor((Date.now() - t.acceptedAt) / (1000 * 60 * 60))
        }))
      }
    });

  } catch (error) {
    console.error('Error getting stuck transactions report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stuck transactions report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = exports;