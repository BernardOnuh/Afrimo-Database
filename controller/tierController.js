const TierConfig = require('../models/TierConfig');
const User = require('../models/User');

/**
 * @desc    Get all share tiers (grouped by type)
 * @route   GET /shares/tiers
 * @access  Public
 */
exports.getTiers = async (req, res) => {
  try {
    const config = await TierConfig.getCurrentConfig();
    const shareTiers = [];
    const cofounderTiers = [];
    const allTiers = {};

    for (const [key, tier] of config.tiers) {
      const tierData = {
        key,
        name: tier.name,
        type: tier.type,
        priceNGN: tier.priceNGN,
        priceUSD: tier.priceUSD,
        percentPerShare: tier.percentPerShare,
        earningPerPhone: tier.earningPerPhone,
        sharesIncluded: tier.sharesIncluded || 1,
      };

      allTiers[key] = tierData;

      if (tier.type === 'share' || tier.type === 'regular') {
        shareTiers.push(tierData);
      } else if (tier.type === 'co-founder' || tier.type === 'cofounder') {
        cofounderTiers.push(tierData);
      }
    }

    res.status(200).json({
      success: true,
      tiers: allTiers,         // flat object (keeps backward compatibility)
      grouped: {
        share: shareTiers,
        cofounder: cofounderTiers,
      },
    });
  } catch (error) {
    console.error('Error fetching tiers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tiers' });
  }
};

/**
 * @desc    Admin: Get all tiers with full details (grouped)
 * @route   GET /shares/tiers/admin
 * @access  Private (Admin)
 */
exports.getAllTiers = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    const config = await TierConfig.getCurrentConfig();
    const shareTiers = [];
    const cofounderTiers = [];

    for (const [key, tier] of config.tiers) {
      const tierData = {
        key,
        name: tier.name,
        type: tier.type,
        priceNGN: tier.priceNGN,
        priceUSD: tier.priceUSD,
        percentPerShare: tier.percentPerShare,
        earningPerPhone: tier.earningPerPhone,
        sharesIncluded: tier.sharesIncluded || 1,
        active: tier.active,
        description: tier.description || '',
        priceHistory: tier.priceHistory || [],
      };

      if (tier.type === 'share' || tier.type === 'regular') {
        shareTiers.push(tierData);
      } else if (tier.type === 'co-founder' || tier.type === 'cofounder') {
        cofounderTiers.push(tierData);
      }
    }

    res.status(200).json({
      success: true,
      tiers: { share: shareTiers, cofounder: cofounderTiers },
    });
  } catch (error) {
    console.error('Error getting tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tiers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * @desc    Update a share tier
 * @route   PUT /shares/tiers/:tierKey
 * @access  Private (Admin)
 */
exports.updateTier = async (req, res) => {
  try {
    const { tierKey } = req.params;
    const updates = req.body;

    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const config = await TierConfig.getCurrentConfig();

    if (!config.tiers.has(tierKey)) {
      return res.status(404).json({ success: false, message: `Tier "${tierKey}" not found` });
    }

    const existing = config.tiers.get(tierKey);
    const updated = { ...(existing.toObject ? existing.toObject() : existing), ...updates };
    config.tiers.set(tierKey, updated);
    await config.save();

    res.status(200).json({ success: true, message: `Tier "${tierKey}" updated`, tier: updated });
  } catch (error) {
    console.error('Error updating tier:', error);
    res.status(500).json({ success: false, message: 'Failed to update tier' });
  }
};

/**
 * @desc    Create a new share tier
 * @route   POST /shares/tiers
 * @access  Private (Admin)
 */
exports.createTier = async (req, res) => {
  try {
    const { key, name, type, priceUSD, priceNGN, percentPerShare, earningPerPhone, sharesIncluded } = req.body;

    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    if (!key || !name || !type || !priceUSD || !priceNGN || !percentPerShare) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: key, name, type, priceUSD, priceNGN, percentPerShare',
      });
    }

    const config = await TierConfig.getCurrentConfig();

    if (config.tiers.has(key)) {
      return res.status(400).json({ success: false, message: `Tier "${key}" already exists` });
    }

    const newTier = {
      name,
      type,
      priceUSD,
      priceNGN,
      percentPerShare,
      earningPerPhone: earningPerPhone || null,
      sharesIncluded: sharesIncluded || 1,
    };

    config.tiers.set(key, newTier);
    await config.save();

    res.status(201).json({ success: true, message: `Tier "${key}" created`, tier: newTier });
  } catch (error) {
    console.error('Error creating tier:', error);
    res.status(500).json({ success: false, message: 'Failed to create tier' });
  }
};

/**
 * @desc    Delete a share tier
 * @route   DELETE /shares/tiers/:tierKey
 * @access  Private (Admin)
 */
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