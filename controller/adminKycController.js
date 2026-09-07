// controller/adminKycController.js - Admin KYC review endpoints.
// Lets admins browse every user's KYC/verification state and manually
// override (approve / disapprove) a verification if the automated result
// isn't convincing, recording the reason + admin for an audit trail.
const mongoose = require('mongoose');
const User = require('../models/User');
const KycVerification = require('../models/KycVerification');

const NON_TERMINAL_DIDIT = ['Not Started', 'In Progress', 'Awaiting User', 'In Review'];

// GET /api/admin/kyc - paginated list of users with their KYC info
async function listKyc(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const statusFilter = req.query.status || 'all';
    const diditStatus = (req.query.diditStatus || '').trim();
    const search = (req.query.search || '').trim();

    const match = {};
    if (statusFilter !== 'all') match.kycStatus = statusFilter;
    if (diditStatus) match['kycData.diditStatus'] = diditStatus;
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [{ name: rx }, { email: rx }, { userName: rx }, { phone: rx }];
    }

    const [filteredTotal, grandTotal, counts, activeSessions, users] = await Promise.all([
      User.countDocuments(match),
      User.countDocuments({}),
      User.aggregate([{ $group: { _id: '$kycStatus', n: { $sum: 1 } } }]),
      KycVerification.countDocuments({ status: { $in: NON_TERMINAL_DIDIT } }),
      User.find(match)
        .select('name email phone profileImage kycStatus isVerified verified kycData createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Attach the most recent Didit verification record per user
    const userIds = users.map((u) => u._id);
    const records = userIds.length
      ? await KycVerification.find({ user: { $in: userIds } })
          .sort({ createdAt: -1 })
          .select('diditSessionId status decision sessionUrl createdAt updatedAt')
          .lean()
      : [];
    const byUser = new Map();
    for (const r of records) {
      const key = String(r.user);
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(r);
    }

    const totals = { all: grandTotal, pending: 0, verified: 0, failed: 0, not_started: 0, kyc_expired: 0 };
    for (const c of counts) if (c._id && c._id in totals) totals[c._id] = c.n;

    return res.status(200).json({
      success: true,
      data: {
        totals,
        activeSessions,
        users: users.map((u) => ({
          _id: u._id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          profileImage: u.profileImage,
          kycStatus: u.kycStatus,
          isVerified: u.isVerified,
          verified: u.verified,
          kycData: u.kycData || null,
          latestVerification: (byUser.get(String(u._id)) || [])[0] || null,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
        pagination: { page, limit, total: filteredTotal, pages: Math.max(1, Math.ceil(filteredTotal / limit)) },
      },
    });
  } catch (error) {
    console.error('❌ Error listing KYC submissions:', error);
    return res.status(500).json({ success: false, message: 'Failed to list KYC submissions' });
  }
}

// GET /api/admin/kyc/:userId - full detail for a single user's KYC
async function getKycDetail(req, res) {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }

    const user = await User.findById(userId)
      .select('name email phone profileImage kycStatus isVerified verified kycData createdAt updatedAt isAdmin')
      .lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const records = await KycVerification.find({ user: userId }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({ success: true, data: { user, records } });
  } catch (error) {
    console.error('❌ Error fetching KYC detail:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch KYC detail' });
  }
}

// POST /api/admin/kyc/:userId/decision - manually approve / disapprove a user's KYC
async function processDecision(req, res) {
  try {
    const { userId } = req.params;
    const { action, reason } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }
    if (action !== 'approve' && action !== 'disapprove') {
      return res.status(400).json({
        success: false,
        message: "action must be 'approve' or 'disapprove'",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const kycData = { ...(user.kycData || {}) };

    if (action === 'approve') {
      user.kycStatus = 'verified';
      user.isVerified = true;
      user.verified = true;
      if (!kycData.verifiedAt) kycData.verifiedAt = new Date();
      delete kycData.failedAt;
      delete kycData.failedReason;
      delete kycData.nextSessionRequired;
    } else {
      user.kycStatus = 'failed';
      user.isVerified = false;
      user.verified = false;
      kycData.failedAt = new Date();
      kycData.failedReason = reason || 'Admin rejected the verification';
      delete kycData.verifiedAt;
      delete kycData.nextSessionRequired;
    }

    kycData.adminReview = {
      action,
      reason: reason || null,
      by: req.user ? req.user._id : null,
      at: new Date(),
    };
    user.kycData = kycData;

    await user.save({ validateModifiedOnly: true });

    return res.status(200).json({
      success: true,
      message: `KYC ${action === 'approve' ? 'approved' : 'rejected'} for ${user.name || user.email || userId}`,
      data: {
        _id: user._id,
        kycStatus: user.kycStatus,
        isVerified: user.isVerified,
        verified: user.verified,
        kycData: user.kycData,
      },
    });
  } catch (error) {
    console.error('❌ Error processing KYC decision:', error);
    return res.status(500).json({ success: false, message: 'Failed to process KYC decision' });
  }
}

module.exports = { listKyc, getKycDetail, processDecision };