/**
 * TIER MANAGEMENT & PACKAGE CONTROLLERS
 * Complete implementation for editing tiers and creating packages
 */

const Share = require('../models/Share');
const Package = require('../models/SharePackage');
const User = require('../models/User');
const { sendEmail } = require('../utils/emailService');

// ============================================================================
// TIER MANAGEMENT CONTROLLERS
// ============================================================================

/**
 * @desc    Edit existing share tier
 * @route   POST /api/shares/admin/tiers/edit
 * @access  Private (Admin)
 */
exports.editShareTier = async (req, res) => {
  try {
    const {
      tier,
      name,
      priceUSD,
      priceNGN,
      percentPerShare,
      earningPerPhone,
      sharesIncluded,
      description,
      reason,
      effectiveDate
    } = req.body;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    // Validate tier exists
    const tierConfig = Share.getTierConfig();
    if (!tierConfig[tier]) {
      return res.status(400).json({
        success: false,
        message: `Invalid tier: ${tier}. Valid tiers: ${Object.keys(tierConfig).join(', ')}`
      });
    }

    // Validation checks
    const errors = [];

    if (priceUSD !== undefined) {
      if (priceUSD < 0.01 || priceUSD > 50000) {
        errors.push({
          field: 'priceUSD',
          message: 'Price must be between 0.01 and 50000'
        });
      }
    }

    if (priceNGN !== undefined) {
      if (priceNGN < 100 || priceNGN > 50000000) {
        errors.push({
          field: 'priceNGN',
          message: 'Price must be between 100 and 50000000'
        });
      }
    }

    if (percentPerShare !== undefined) {
      if (percentPerShare < 0.00001 || percentPerShare > 0.1) {
        errors.push({
          field: 'percentPerShare',
          message: 'Percentage must be between 0.00001 and 0.1'
        });
      }
    }

    if (earningPerPhone !== undefined && earningPerPhone < 0) {
      errors.push({
        field: 'earningPerPhone',
        message: 'Earning must be non-negative'
      });
    }

    if (sharesIncluded !== undefined) {
      if (sharesIncluded < 1 || sharesIncluded > 1000) {
        errors.push({
          field: 'sharesIncluded',
          message: 'Shares included must be between 1 and 1000'
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors
      });
    }

    // Get current config for audit trail
    const shareConfig = await Share.getCurrentConfig();
    const currentTier = shareConfig.tiers[tier];
    
    // Prepare update object
    const updateData = {};
    const changedFields = [];

    if (name !== undefined) {
      updateData.name = name;
      if (currentTier.name !== name) changedFields.push('name');
    }
    if (priceUSD !== undefined) {
      updateData.priceUSD = priceUSD;
      if (currentTier.priceUSD !== priceUSD) changedFields.push('priceUSD');
    }
    if (priceNGN !== undefined) {
      updateData.priceNGN = priceNGN;
      if (currentTier.priceNGN !== priceNGN) changedFields.push('priceNGN');
    }
    if (percentPerShare !== undefined) {
      updateData.percentPerShare = percentPerShare;
      if (currentTier.percentPerShare !== percentPerShare) changedFields.push('percentPerShare');
    }
    if (earningPerPhone !== undefined) {
      updateData.earningPerPhone = earningPerPhone;
      if (currentTier.earningPerPhone !== earningPerPhone) changedFields.push('earningPerPhone');
    }
    if (sharesIncluded !== undefined) {
      updateData.sharesIncluded = sharesIncluded;
      if (currentTier.sharesIncluded !== sharesIncluded) changedFields.push('sharesIncluded');
    }
    if (description !== undefined) {
      updateData.description = description;
    }

    // Update tier configuration
    Object.assign(shareConfig.tiers[tier], updateData);
    
    // Store audit trail
    if (!shareConfig.auditTrail) {
      shareConfig.auditTrail = [];
    }

    shareConfig.auditTrail.push({
      action: 'tier_edit',
      tier,
      adminId,
      timestamp: new Date(),
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      reason,
      fieldsChanged: changedFields,
      previousValues: {
        priceUSD: currentTier.priceUSD,
        priceNGN: currentTier.priceNGN,
        percentPerShare: currentTier.percentPerShare,
        earningPerPhone: currentTier.earningPerPhone,
        sharesIncluded: currentTier.sharesIncluded
      },
      newValues: updateData
    });

    await shareConfig.save();

    // Notify other admins
    const admins = await User.find({ isAdmin: true, _id: { $ne: adminId } });
    for (const admin of admins) {
      if (admin.email) {
        try {
          await sendEmail({
            email: admin.email,
            subject: `[ALERT] Share Tier Updated: ${tier.toUpperCase()}`,
            html: `
              <h2>Tier Update Notification</h2>
              <p>Admin <strong>${admin.name}</strong> updated the <strong>${tier}</strong> tier.</p>
              <p><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
              <p><strong>Effective Date:</strong> ${effectiveDate ? new Date(effectiveDate).toLocaleDateString() : 'Immediately'}</p>
              <p><strong>Changes Made:</strong></p>
              <ul>
                ${changedFields.map(field => `<li>${field}: ${updateData[field]}</li>`).join('')}
              </ul>
            `
          });
        } catch (emailError) {
          console.error('Failed to send admin notification:', emailError);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Tier '${tier}' updated successfully`,
      previousValues: {
        priceUSD: currentTier.priceUSD,
        priceNGN: currentTier.priceNGN,
        percentPerShare: currentTier.percentPerShare,
        earningPerPhone: currentTier.earningPerPhone
      },
      updatedValues: updateData,
      auditTrail: {
        adminId,
        timestamp: new Date().toISOString(),
        effectiveDate: effectiveDate || new Date().toISOString(),
        reason,
        fieldsChanged: changedFields
      }
    });
  } catch (error) {
    console.error('Error editing share tier:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to edit share tier',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Bulk update multiple tiers
 * @route   POST /api/shares/admin/tiers/bulk-update
 * @access  Private (Admin)
 */
exports.bulkUpdateTiers = async (req, res) => {
  try {
    const { updates, reason, effectiveDate } = req.body;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Updates array is required and must not be empty'
      });
    }

    if (updates.length > 6) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update more than 6 tiers at once'
      });
    }

    const shareConfig = await Share.getCurrentConfig();
    const tierConfig = Share.getTierConfig();
    const results = [];
    let successCount = 0;

    // Process each update
    for (const update of updates) {
      const { tier } = update;

      // Validate tier exists
      if (!tierConfig[tier]) {
        results.push({
          tier,
          status: 'failed',
          error: `Invalid tier: ${tier}`
        });
        continue;
      }

      try {
        const currentTier = shareConfig.tiers[tier];
        const updateData = {};
        const changedFields = [];

        // Apply updates with same validation as single tier edit
        if (update.priceUSD !== undefined) {
          if (update.priceUSD < 0.01 || update.priceUSD > 50000) {
            throw new Error('priceUSD: Price must be between 0.01 and 50000');
          }
          updateData.priceUSD = update.priceUSD;
          changedFields.push('priceUSD');
        }

        if (update.priceNGN !== undefined) {
          if (update.priceNGN < 100 || update.priceNGN > 50000000) {
            throw new Error('priceNGN: Price must be between 100 and 50000000');
          }
          updateData.priceNGN = update.priceNGN;
          changedFields.push('priceNGN');
        }

        if (update.percentPerShare !== undefined) {
          if (update.percentPerShare < 0.00001 || update.percentPerShare > 0.1) {
            throw new Error('percentPerShare: Percentage must be between 0.00001 and 0.1');
          }
          updateData.percentPerShare = update.percentPerShare;
          changedFields.push('percentPerShare');
        }

        if (update.earningPerPhone !== undefined) {
          if (update.earningPerPhone < 0) {
            throw new Error('earningPerPhone: Must be non-negative');
          }
          updateData.earningPerPhone = update.earningPerPhone;
          changedFields.push('earningPerPhone');
        }

        if (update.sharesIncluded !== undefined) {
          if (update.sharesIncluded < 1 || update.sharesIncluded > 1000) {
            throw new Error('sharesIncluded: Must be between 1 and 1000');
          }
          updateData.sharesIncluded = update.sharesIncluded;
          changedFields.push('sharesIncluded');
        }

        // Apply updates
        Object.assign(shareConfig.tiers[tier], updateData);

        results.push({
          tier,
          status: 'success',
          changes: updateData,
          fieldsChanged: changedFields
        });
        successCount++;
      } catch (tierError) {
        results.push({
          tier,
          status: 'failed',
          error: tierError.message
        });
      }
    }

    // Save all changes atomically
    if (successCount > 0) {
      // Store bulk audit trail
      if (!shareConfig.auditTrail) {
        shareConfig.auditTrail = [];
      }

      shareConfig.auditTrail.push({
        action: 'bulk_tier_update',
        adminId,
        timestamp: new Date(),
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        reason,
        tiersUpdated: results.filter(r => r.status === 'success').map(r => r.tier),
        resultSummary: {
          total: updates.length,
          successful: successCount,
          failed: updates.length - successCount
        }
      });

      await shareConfig.save();
    }

    res.status(200).json({
      success: successCount === updates.length,
      message: `${successCount} of ${updates.length} tiers updated`,
      updates: results,
      summary: {
        totalRequested: updates.length,
        successful: successCount,
        failed: updates.length - successCount
      }
    });
  } catch (error) {
    console.error('Error in bulk tier update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update tiers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all tier configurations
 * @route   GET /api/shares/admin/tiers
 * @access  Private (Admin)
 */
exports.getAllTiers = async (req, res) => {
  try {
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    const tiers = Share.getTierConfig();
    const shareConfig = await Share.getCurrentConfig();

    // Enrich with sales data
    const tiersWithSales = {};
    const regularTiers = {};
    const cofounderTiers = {};

    Object.entries(tiers).forEach(([key, tier]) => {
      const tierWithData = {
        ...tier,
        sold: shareConfig.tierSales[`${key}Sold`] || 0
      };

      tiersWithSales[key] = tierWithData;

      if (tier.type === 'regular') {
        regularTiers[key] = tierWithData;
      } else {
        cofounderTiers[key] = tierWithData;
      }
    });

    // Calculate summary
    const summary = {
      totalRegularTiers: Object.keys(regularTiers).length,
      totalCoFounderTiers: Object.keys(cofounderTiers).length,
      totalSold: shareConfig.sharesSold,
      totalRegularSold: Object.values(regularTiers).reduce((sum, t) => sum + (t.sold || 0), 0),
      totalCoFounderSold: Object.values(cofounderTiers).reduce((sum, t) => sum + (t.sold || 0), 0),
      totalRevenue: {
        USD: Object.entries(tiers).reduce((sum, [key, tier]) => {
          const sold = shareConfig.tierSales[`${key}Sold`] || 0;
          return sum + (sold * tier.priceUSD);
        }, 0),
        NGN: Object.entries(tiers).reduce((sum, [key, tier]) => {
          const sold = shareConfig.tierSales[`${key}Sold`] || 0;
          return sum + (sold * tier.priceNGN);
        }, 0)
      }
    };

    res.status(200).json({
      success: true,
      tiers: tiersWithSales,
      regularTiers,
      cofounderTiers,
      summary
    });
  } catch (error) {
    console.error('Error getting all tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tier configurations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get tier change history
 * @route   GET /api/shares/admin/tiers/history
 * @access  Private (Admin)
 */
exports.getTierChangeHistory = async (req, res) => {
  try {
    const { tier, page = 1, limit = 20 } = req.query;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    const shareConfig = await Share.getCurrentConfig();
    let history = shareConfig.auditTrail || [];

    // Filter by tier if specified
    if (tier) {
      history = history.filter(entry => entry.tier === tier || (entry.tiersUpdated && entry.tiersUpdated.includes(tier)));
    }

    // Sort by timestamp (newest first)
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Paginate
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedHistory = history.slice(skip, skip + parseInt(limit));

    // Enrich with admin names
    const enrichedHistory = await Promise.all(
      paginatedHistory.map(async (entry) => {
        const tierAdmin = await User.findById(entry.adminId).select('name email');
        return {
          ...entry,
          adminName: tierAdmin?.name || 'Unknown Admin'
        };
      })
    );

    res.status(200).json({
      success: true,
      history: enrichedHistory,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(history.length / parseInt(limit)),
        totalRecords: history.length
      }
    });
  } catch (error) {
    console.error('Error getting tier history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tier change history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// PACKAGE MANAGEMENT CONTROLLERS
// ============================================================================

/**
 * @desc    Create new investment package
 * @route   POST /api/shares/admin/packages/create
 * @access  Private (Admin)
 */
exports.createPackage = async (req, res) => {
  try {
    const {
      name,
      description,
      packageType,
      tiers,
      totalDiscount,
      bonusShares,
      bonusPercentage,
      available,
      availableFrom,
      availableUntil,
      maxPurchases,
      benefits,
      requirements
    } = req.body;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    // Validation
    const errors = [];

    if (!name || name.length === 0 || name.length > 100) {
      errors.push({ field: 'name', message: 'Name is required and must be 1-100 characters' });
    }

    if (!description || description.length > 1000) {
      errors.push({ field: 'description', message: 'Description is required and must be under 1000 characters' });
    }

    if (!packageType || !['bundle', 'promotional', 'seasonal', 'custom', 'loyalty'].includes(packageType)) {
      errors.push({ field: 'packageType', message: 'Valid package type is required' });
    }

    if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
      errors.push({ field: 'tiers', message: 'At least one tier is required' });
    }

    if (totalDiscount !== undefined) {
      if (totalDiscount < 0 || totalDiscount > 50) {
        errors.push({ field: 'totalDiscount', message: 'Discount must be between 0 and 50' });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors
      });
    }

    // Calculate package pricing
    const tierConfig = Share.getTierConfig();
    let totalPriceUSD = 0;
    let totalPriceNGN = 0;
    let totalSharesIncluded = 0;
    const tierBreakdown = [];

    for (const tierItem of tiers) {
      const tier = tierConfig[tierItem.tier];
      if (!tier) {
        return res.status(400).json({
          success: false,
          message: `Invalid tier: ${tierItem.tier}`
        });
      }

      const quantity = tierItem.quantity || 1;
      const tierDiscount = tierItem.discount || 0;

      const tierTotalUSD = tier.priceUSD * quantity * (1 - tierDiscount / 100);
      const tierTotalNGN = tier.priceNGN * quantity * (1 - tierDiscount / 100);

      totalPriceUSD += tierTotalUSD;
      totalPriceNGN += tierTotalNGN;
      totalSharesIncluded += tier.sharesIncluded * quantity;

      tierBreakdown.push({
        tier: tierItem.tier,
        quantity,
        discount: tierDiscount,
        priceUSD: tierTotalUSD,
        priceNGN: tierTotalNGN,
        shares: tier.sharesIncluded * quantity
      });
    }

    // Apply package-level discount
    const discount = totalDiscount || 0;
    const discountedPriceUSD = totalPriceUSD * (1 - discount / 100);
    const discountedPriceNGN = totalPriceNGN * (1 - discount / 100);

    // Create package
    const packageData = {
      name,
      description,
      packageType,
      tiers: tierBreakdown,
      pricing: {
        originalUSD: totalPriceUSD,
        originalNGN: totalPriceNGN,
        discountedUSD: discountedPriceUSD,
        discountedNGN: discountedPriceNGN,
        discount: discount,
        savingsUSD: totalPriceUSD - discountedPriceUSD,
        savingsNGN: totalPriceNGN - discountedPriceNGN
      },
      shares: {
        totalShares: totalSharesIncluded,
        bonusShares: bonusShares || 0,
        bonusPercentage: bonusPercentage || 0,
        totalWithBonus: totalSharesIncluded + (bonusShares || 0)
      },
      availability: {
        available: available !== false,
        availableFrom: availableFrom ? new Date(availableFrom) : new Date(),
        availableUntil: availableUntil ? new Date(availableUntil) : null,
        maxPurchases: maxPurchases || null,
        purchaseCount: 0
      },
      benefits: benefits || [],
      requirements: requirements || {},
      createdBy: adminId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const newPackage = new Package(packageData);
    await newPackage.save();

    // Notify admins
    const admins = await User.find({ isAdmin: true, _id: { $ne: adminId } });
    for (const adm of admins) {
      if (adm.email) {
        try {
          await sendEmail({
            email: adm.email,
            subject: `[NEW] Package Created: ${name}`,
            html: `
              <h2>New Package Created</h2>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Type:</strong> ${packageType}</p>
              <p><strong>Price:</strong> $${discountedPriceUSD.toFixed(2)} / ₦${discountedPriceNGN.toFixed(0)}</p>
              <p><strong>Discount:</strong> ${discount}%</p>
              <p><strong>Total Shares:</strong> ${totalSharesIncluded}</p>
              <p><strong>Available:</strong> ${available !== false ? 'Yes' : 'No'}</p>
            `
          });
        } catch (emailError) {
          console.error('Failed to send admin notification:', emailError);
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `Package '${name}' created successfully`,
      package: {
        id: newPackage._id,
        ...packageData
      }
    });
  } catch (error) {
    console.error('Error creating package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create package',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Get all packages
 * @route   GET /api/shares/admin/packages
 * @access  Private (Admin)
 */
exports.getAllPackages = async (req, res) => {
  try {
    const { active, type, page = 1, limit = 20 } = req.query;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    const query = {};

    if (active !== undefined) {
      query['availability.available'] = active === 'true';
    }

    if (type) {
      query.packageType = type;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const packages = await Package.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Package.countDocuments(query);

    res.status(200).json({
      success: true,
      packages,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalCount: total
      }
    });
  } catch (error) {
    console.error('Error getting packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get packages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Edit existing package
 * @route   PUT /api/shares/admin/packages/:packageId/edit
 * @access  Private (Admin)
 */
exports.editPackage = async (req, res) => {
  try {
    const { packageId } = req.params;
    const { name, description, totalDiscount, bonusShares, available, availableUntil, benefits } = req.body;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    const packageToUpdate = await Package.findById(packageId);
    if (!packageToUpdate) {
      return res.status(404).json({
        success: false,
        message: 'Package not found'
      });
    }

    // Update fields
    if (name) packageToUpdate.name = name;
    if (description) packageToUpdate.description = description;
    if (totalDiscount !== undefined) packageToUpdate.pricing.discount = totalDiscount;
    if (bonusShares !== undefined) packageToUpdate.shares.bonusShares = bonusShares;
    if (available !== undefined) packageToUpdate.availability.available = available;
    if (availableUntil) packageToUpdate.availability.availableUntil = new Date(availableUntil);
    if (benefits) packageToUpdate.benefits = benefits;

    packageToUpdate.updatedAt = new Date();

    await packageToUpdate.save();

    res.status(200).json({
      success: true,
      message: 'Package updated successfully',
      package: packageToUpdate
    });
  } catch (error) {
    console.error('Error editing package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to edit package',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * @desc    Delete package
 * @route   DELETE /api/shares/admin/packages/:packageId/delete
 * @access  Private (Admin)
 */
exports.deletePackage = async (req, res) => {
  try {
    const { packageId } = req.params;
    const adminId = req.user.id;

    // Validate admin
    const admin = await User.findById(adminId);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }

    const packageToDelete = await Package.findById(packageId);
    if (!packageToDelete) {
      return res.status(404).json({
        success: false,
        message: 'Package not found'
      });
    }

    // Check if package has sales
    if (packageToDelete.availability.purchaseCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete package with sales. Archive it instead.'
      });
    }

    await Package.findByIdAndDelete(packageId);

    res.status(200).json({
      success: true,
      message: 'Package deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting package:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete package',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  editShareTier: exports.editShareTier,
  bulkUpdateTiers: exports.bulkUpdateTiers,
  getAllTiers: exports.getAllTiers,
  getTierChangeHistory: exports.getTierChangeHistory,
  createPackage: exports.createPackage,
  getAllPackages: exports.getAllPackages,
  editPackage: exports.editPackage,
  deletePackage: exports.deletePackage
};