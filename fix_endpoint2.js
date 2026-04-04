const fs = require('fs');
let content = fs.readFileSync('routes/shareRoutes.js', 'utf8');

const oldEndpoint = `// GET /api/shares/user/earnings-summary
router.get('/user/earnings-summary', protect, async (req, res) => {`;

const newEndpoint = `// GET /api/shares/user/earnings-summary
router.get('/user/earnings-summary', protect, async (req, res) => {
  try {
    const UserShare = require('../models/UserShare');

    const PRICE_MAP = {
      // Naira packages
      25000:   { earningKobo: 6000,  ownershipPct: 0.00001  },
      30000:   { earningKobo: 6000,  ownershipPct: 0.00001  },
      35000:   { earningKobo: 6000,  ownershipPct: 0.00001  },
      40000:   { earningKobo: 14000, ownershipPct: 0.000021 },
      50000:   { earningKobo: 14000, ownershipPct: 0.000021 },
      55000:   { earningKobo: 14000, ownershipPct: 0.000021 },
      70000:   { earningKobo: 30000, ownershipPct: 0.00005  },
      75000:   { earningKobo: 30000, ownershipPct: 0.00005  },
      100000:  { earningKobo: 30000, ownershipPct: 0.00005  },
      // Co-founder naira
      500000:  { earningKobo: 14000, ownershipPct: 0.000021 },
      700000:  { earningKobo: 14000, ownershipPct: 0.000021 },
      800000:  { earningKobo: 14000, ownershipPct: 0.000462 },
      1000000: { earningKobo: 14000, ownershipPct: 0.000462 },
      2000000: { earningKobo: 14000, ownershipPct: 0.00135  },
      3500000: { earningKobo: 14000, ownershipPct: 0.003    },
      // USDT prices (approximate naira equivalent for matching)
      30:  { earningKobo: 6000,  ownershipPct: 0.00001  },
      40:  { earningKobo: 14000, ownershipPct: 0.000021 },
      50:  { earningKobo: 14000, ownershipPct: 0.000021 },
      75:  { earningKobo: 30000, ownershipPct: 0.00005  },
      100: { earningKobo: 30000, ownershipPct: 0.00005  },
    };

    const userShare = await UserShare.findOne({ user: req.user.id }).lean();

    let totalEarnings = 0;
    let totalOwnershipPct = 0;

    if (userShare && userShare.transactions) {
      userShare.transactions
        .filter(t => t.status === 'completed')
        .forEach(t => {
          const pps = t.pricePerShare || 0;
          const mapping = PRICE_MAP[pps] || { earningKobo: 6000, ownershipPct: 0.00001 };
          totalEarnings += mapping.earningKobo * (t.shares || 0);
          totalOwnershipPct += mapping.ownershipPct * (t.shares || 0);
        });
    }

    res.json({
      success: true,
      totalEarnings,
      totalOwnershipPct,
      formattedOwnership: totalOwnershipPct.toFixed(7) + '%'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/shares/user/earnings-summary-OLD-REPLACED
router.get('/user/earnings-summary-disabled', protect, async (req, res) => {`;

content = content.replace(oldEndpoint, newEndpoint);
fs.writeFileSync('routes/shareRoutes.js', content);
console.log('Done');
