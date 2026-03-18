const externalApiService = require('../services/externalApiService');

// ==================== PARTNER ENDPOINTS ====================

// GET /api/external/products - List available products
exports.getProducts = async (req, res) => {
  try {
    const products = await externalApiService.getAvailableProducts();
    res.json({ success: true, data: products });
  } catch (error) {
    console.error('External API - getProducts error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/external/orders - Place an order
exports.createOrder = async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'items array is required and must not be empty. Each item needs: productId, quantity, mobileNumber'
      });
    }

    // Validate each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId) {
        return res.status(400).json({
          success: false,
          message: `Item at index ${i} is missing productId`
        });
      }
      if (!item.quantity || parseInt(item.quantity) < 1) {
        return res.status(400).json({
          success: false,
          message: `Item at index ${i} has invalid quantity`
        });
      }
      if (!item.mobileNumber) {
        return res.status(400).json({
          success: false,
          message: `Item at index ${i} is missing mobileNumber`
        });
      }
    }

    const order = await externalApiService.createExternalOrder(req.partner.id, items);

    // Emit real-time notification to admin
    try {
      const io = req.app.get('io');
      if (io) io.emit('new-order', { orderId: order.orderId, partner: req.partner.name, itemCount: items.length });
    } catch (e) { /* socket emit is best-effort */ }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: order
    });
  } catch (error) {
    console.error('External API - createOrder error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/external/orders/:orderId - Check order status
exports.getOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await externalApiService.getExternalOrderStatus(orderId);
    res.json({ success: true, data: order });
  } catch (error) {
    console.error('External API - getOrderStatus error:', error);
    res.status(404).json({ success: false, message: error.message });
  }
};

// POST /api/external/orders/status - Check multiple order statuses
exports.getOrderStatuses = async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'orderIds array is required'
      });
    }

    if (orderIds.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 50 order IDs per request'
      });
    }

    const orders = await externalApiService.getExternalOrderStatuses(orderIds);
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('External API - getOrderStatuses error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== ADMIN ENDPOINTS ====================

// POST /api/external/admin/keys - Generate new API key
exports.createApiKey = async (req, res) => {
  try {
    const { partnerName } = req.body;

    if (!partnerName || partnerName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'partnerName is required'
      });
    }

    const result = await externalApiService.createApiKey(partnerName.trim());

    res.status(201).json({
      success: true,
      message: 'API key created. Share this key with your partner. It will only be shown once.',
      data: result
    });
  } catch (error) {
    console.error('External API - createApiKey error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/external/admin/keys - List all API keys
exports.listApiKeys = async (req, res) => {
  try {
    const keys = await externalApiService.listApiKeys();
    res.json({ success: true, data: keys });
  } catch (error) {
    console.error('External API - listApiKeys error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/external/admin/keys/:id/revoke - Revoke an API key
exports.revokeApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    await externalApiService.revokeApiKey(id);
    res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    console.error('External API - revokeApiKey error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/external/admin/keys/:id/activate - Reactivate an API key
exports.activateApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    await externalApiService.activateApiKey(id);
    res.json({ success: true, message: 'API key reactivated' });
  } catch (error) {
    console.error('External API - activateApiKey error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/external/admin/keys/:id - Delete an API key permanently
exports.deleteApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    await externalApiService.deleteApiKey(id);
    res.json({ success: true, message: 'API key deleted permanently' });
  } catch (error) {
    console.error('External API - deleteApiKey error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
