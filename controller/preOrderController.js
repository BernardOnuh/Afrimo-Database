const PreOrder = require('../models/PreOrder');

// POST - User creates a pre-order
exports.createPreOrder = async (req, res) => {
  try {
    const { fullName, email, phone, alternativePhone, country, state, city, address, quantity, preferredColor, notes } = req.body;

    if (!fullName || !email || !phone || !country || !state || !city || !address) {
      return res.status(400).json({ success: false, message: 'Please fill in all required fields' });
    }

    const preOrder = await PreOrder.create({
      userId: req.user._id,
      fullName,
      email,
      phone,
      alternativePhone,
      country,
      state,
      city,
      address,
      quantity: quantity || 1,
      preferredColor,
      notes
    });

    res.status(201).json({ success: true, message: 'Pre-order submitted successfully', data: preOrder });
  } catch (error) {
    console.error('Create pre-order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create pre-order', error: error.message });
  }
};

// GET - User gets their pre-orders
exports.getMyPreOrders = async (req, res) => {
  try {
    const preOrders = await PreOrder.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: preOrders });
  } catch (error) {
    console.error('Get my pre-orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pre-orders', error: error.message });
  }
};

// PUT - User updates their pending pre-order
exports.updatePreOrder = async (req, res) => {
  try {
    const preOrder = await PreOrder.findOne({ _id: req.params.id, userId: req.user._id });

    if (!preOrder) {
      return res.status(404).json({ success: false, message: 'Pre-order not found' });
    }

    if (preOrder.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending pre-orders can be updated' });
    }

    const allowedFields = ['fullName', 'email', 'phone', 'alternativePhone', 'country', 'state', 'city', 'address', 'quantity', 'preferredColor', 'notes'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        preOrder[field] = req.body[field];
      }
    });

    await preOrder.save();
    res.json({ success: true, message: 'Pre-order updated successfully', data: preOrder });
  } catch (error) {
    console.error('Update pre-order error:', error);
    res.status(500).json({ success: false, message: 'Failed to update pre-order', error: error.message });
  }
};

// PUT - User cancels their pending pre-order
exports.cancelPreOrder = async (req, res) => {
  try {
    const preOrder = await PreOrder.findOne({ _id: req.params.id, userId: req.user._id });

    if (!preOrder) {
      return res.status(404).json({ success: false, message: 'Pre-order not found' });
    }

    if (preOrder.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending pre-orders can be cancelled' });
    }

    preOrder.status = 'cancelled';
    await preOrder.save();
    res.json({ success: true, message: 'Pre-order cancelled successfully', data: preOrder });
  } catch (error) {
    console.error('Cancel pre-order error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel pre-order', error: error.message });
  }
};

// GET - Admin lists all pre-orders with filters
exports.adminGetAllPreOrders = async (req, res) => {
  try {
    const { status, country, state, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (country) filter.country = { $regex: country, $options: 'i' };
    if (state) filter.state = { $regex: state, $options: 'i' };
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { trackingNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [preOrders, total] = await Promise.all([
      PreOrder.find(filter).populate('userId', 'name email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      PreOrder.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: preOrders,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    console.error('Admin get all pre-orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pre-orders', error: error.message });
  }
};

// PUT - Admin updates pre-order status
exports.adminUpdatePreOrderStatus = async (req, res) => {
  try {
    const { status, trackingNumber, adminNotes, estimatedDelivery } = req.body;
    const preOrder = await PreOrder.findById(req.params.id);

    if (!preOrder) {
      return res.status(404).json({ success: false, message: 'Pre-order not found' });
    }

    if (status) preOrder.status = status;
    if (trackingNumber !== undefined) preOrder.trackingNumber = trackingNumber;
    if (adminNotes !== undefined) preOrder.adminNotes = adminNotes;
    if (estimatedDelivery) preOrder.estimatedDelivery = estimatedDelivery;

    await preOrder.save();
    res.json({ success: true, message: 'Pre-order updated successfully', data: preOrder });
  } catch (error) {
    console.error('Admin update pre-order status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update pre-order', error: error.message });
  }
};

// GET - Admin gets pre-order stats
exports.adminGetPreOrderStats = async (req, res) => {
  try {
    const [statusStats, countryStats, total] = await Promise.all([
      PreOrder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, totalQuantity: { $sum: '$quantity' } } }
      ]),
      PreOrder.aggregate([
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      PreOrder.countDocuments()
    ]);

    const byStatus = {};
    statusStats.forEach(s => { byStatus[s._id] = { count: s.count, totalQuantity: s.totalQuantity }; });

    res.json({
      success: true,
      data: {
        total,
        byStatus,
        byCountry: countryStats.map(c => ({ country: c._id, count: c.count }))
      }
    });
  } catch (error) {
    console.error('Admin get pre-order stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats', error: error.message });
  }
};
