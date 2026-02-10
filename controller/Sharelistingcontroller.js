const ShareListing = require('../models/Sharelisting');
const SharePurchaseOffer = require('../models/Sharepurchaseoffer');
const ShareTransferRecord = require('../models/Sharetransferrecord');
const UserShare = require('../models/UserShare');
const User = require('../models/User');
const { sendEmail } = require('../utils/emailService');
const axios = require('axios');
const crypto = require('crypto');

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

module.exports = exports;