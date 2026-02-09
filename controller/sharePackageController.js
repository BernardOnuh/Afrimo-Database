const SharePackage = require('../models/SharePackage');

// GET /api/share-packages - public, active packages sorted by displayOrder
exports.getAllPackages = async (req, res) => {
  try {
    const packages = await SharePackage.find({ isActive: true }).sort({ displayOrder: 1 });
    res.json({ success: true, packages });
  } catch (err) {
    console.error('Error fetching packages:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/share-packages/admin - admin, all packages
exports.getAdminPackages = async (req, res) => {
  try {
    const packages = await SharePackage.find().sort({ displayOrder: 1 });
    res.json({ success: true, packages });
  } catch (err) {
    console.error('Error fetching admin packages:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/share-packages - admin, create
exports.createPackage = async (req, res) => {
  try {
    const { name, description, sharesIncluded, priceNaira, priceUSDT, benefits, isActive, displayOrder, maxPurchasePerUser, color, icon } = req.body;

    if (!name || !sharesIncluded || priceNaira == null || priceUSDT == null) {
      return res.status(400).json({ success: false, message: 'name, sharesIncluded, priceNaira, and priceUSDT are required' });
    }

    const pkg = await SharePackage.create({
      name, description, sharesIncluded, priceNaira, priceUSDT,
      benefits: benefits || [],
      isActive: isActive !== undefined ? isActive : true,
      displayOrder: displayOrder || 0,
      maxPurchasePerUser: maxPurchasePerUser || 0,
      color: color || '#6366f1',
      icon: icon || 'package'
    });

    res.status(201).json({ success: true, package: pkg });
  } catch (err) {
    console.error('Error creating package:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PUT /api/share-packages/:id - admin, update
exports.updatePackage = async (req, res) => {
  try {
    const pkg = await SharePackage.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });
    res.json({ success: true, package: pkg });
  } catch (err) {
    console.error('Error updating package:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/share-packages/:id - admin, soft delete
exports.deletePackage = async (req, res) => {
  try {
    const { hard } = req.query;
    const pkg = await SharePackage.findById(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, message: 'Package not found' });

    if (hard === 'true') {
      await SharePackage.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: 'Package permanently deleted' });
    }

    pkg.isActive = false;
    await pkg.save();
    res.json({ success: true, message: 'Package deactivated', package: pkg });
  } catch (err) {
    console.error('Error deleting package:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PUT /api/share-packages/reorder - admin, reorder
exports.reorderPackages = async (req, res) => {
  try {
    const { orders } = req.body; // [{ id, displayOrder }]
    if (!Array.isArray(orders)) {
      return res.status(400).json({ success: false, message: 'orders array is required' });
    }

    const ops = orders.map(o => ({
      updateOne: {
        filter: { _id: o.id },
        update: { displayOrder: o.displayOrder }
      }
    }));
    await SharePackage.bulkWrite(ops);

    const packages = await SharePackage.find().sort({ displayOrder: 1 });
    res.json({ success: true, packages });
  } catch (err) {
    console.error('Error reordering packages:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
