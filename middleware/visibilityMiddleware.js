const AdminSettings = require('../models/AdminSettings');

// Cache for settings (invalidated on updates)
let settingsCache = null;
let cacheExpiry = null;

const getVisibilitySettings = async () => {
  const now = Date.now();
  
  // Use cache if valid (5 minutes)
  if (settingsCache && cacheExpiry && now < cacheExpiry) {
    return settingsCache;
  }
  
  try {
    let settings = await AdminSettings.findOne();
    
    // Create default settings if none exist
    if (!settings) {
      settings = { showEarnings: true, showAvailableBalance: true };
    }
    
    // Cache for 5 minutes
    settingsCache = settings;
    cacheExpiry = now + (5 * 60 * 1000);
    
    return settings;
  } catch (error) {
    console.error('Error fetching visibility settings:', error);
    return { showEarnings: true, showAvailableBalance: true };
  }
};

const invalidateCache = () => {
  settingsCache = null;
  cacheExpiry = null;
};

const applyVisibilityRules = async (req, res, next) => {
  // Skip for admin users
  if (req.user && req.user.role && ['admin', 'superadmin'].includes(req.user.role)) {
    return next();
  }
  
  try {
    const settings = await getVisibilitySettings();
    
    // Store original res.json
    const originalJson = res.json;
    
    // Override res.json to apply visibility rules
    res.json = function(data) {
      if (data && data.success && (data.leaderboard || data.data)) {
        const users = data.leaderboard || data.data;
        
        if (Array.isArray(users)) {
          users.forEach(user => {
            if (!settings.showEarnings) {
              if (user.totalEarnings !== undefined) user.totalEarnings = "Hidden";
              if (user.periodEarnings !== undefined) user.periodEarnings = "Hidden";
            }
            
            if (!settings.showAvailableBalance) {
              if (user.currentBalance !== undefined) user.currentBalance = "Hidden";
              if (user.availableBalance !== undefined) user.availableBalance = "Hidden";
            }
          });
        }
      }
      
      return originalJson.call(this, data);
    };
    
    next();
  } catch (error) {
    console.error('Error applying visibility rules:', error);
    next();
  }
};

module.exports = {
  applyVisibilityRules,
  invalidateCache,
  getVisibilitySettings
};