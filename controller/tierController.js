const TierConfig = require('../models/TierConfig');
const { SHARE_TIERS } = require('../models/Share');
const User = require('../models/User');

// GET /api/shares/tiers — return all tiers
exports.getTiers = async (req, res) => {
  try {
    const tiers = await TierConfig.getTiersObject();
    res.status(200).json({ success: true, tiers });
  } catch (error) {
    console.error('Error fetching tiers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tiers' });
  }
};

// PUT /api/shares/tiers/:tierKey — update a tier
exports.updateTier = async (req, res) => {
  try {
    const { tierKey } = req.params;
    const updates = req.body;

    // Verify admin
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const config = await TierConfig.getCurrentConfig();
    
    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({ success: false, message: `Tier "${tierKey}" not found` });
    }

    const existing = config.tiers.get(tierKey);
    const updated = { ...existing.toObject ? existing.toObject() : existing, ...updates };
    config.tiers.set(tierKey, updated);
    await config.save();

    res.status(200).json({ success: true, message: `Tier "${tierKey}" updated`, tier: updated });
  } catch (error) {
    console.error('Error updating tier:', error);
    res.status(500).json({ success: false, message: 'Failed to update tier' });
  }
};

// POST /api/shares/tiers — create a new tier
exports.createTier = async (req, res) => {
  try {
    const { key, name, type, priceUSD, priceNGN, percentPerShare, earningPerPhone, sharesIncluded } = req.body;

    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    if (!key || !name || !type || !priceUSD || !priceNGN || !percentPerShare) {
      return res.status(400).json({ success: false, message: 'Missing required fields: key, name, type, priceUSD, priceNGN, percentPerShare' });
    }

    const config = await TierConfig.getCurrentConfig();
    
    if (config.tiers.has(key)) {
      return res.status(400).json({ success: false, message: `Tier "${key}" already exists` });
    }

    const newTier = { name, type, priceUSD, priceNGN, percentPerShare, earningPerPhone: earningPerPhone || null, sharesIncluded: sharesIncluded || 1 };
    config.tiers.set(key, newTier);
    await config.save();

    res.status(201).json({ success: true, message: `Tier "${key}" created`, tier: newTier });
  } catch (error) {
    console.error('Error creating tier:', error);
    res.status(500).json({ success: false, message: 'Failed to create tier' });
  }
};

// DELETE /api/shares/tiers/:tierKey — delete a tier
exports.deleteTier = async (req, res) => {
  try {
    const { tierKey } = req.params;

    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const config = await TierConfig.getCurrentConfig();
    
    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({ success: false, message: `Tier "${tierKey}" not found` });
    }

    config.tiers.delete(tierKey);
    await config.save();

    res.status(200).json({ success: true, message: `Tier "${tierKey}" deleted` });
  } catch (error) {
    console.error('Error deleting tier:', error);
    res.status(500).json({ success: false, message: 'Failed to delete tier' });
  }
};
