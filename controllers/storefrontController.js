const storefrontService = require('../services/storefrontService');

// ==================== AGENT STOREFRONT MANAGEMENT ====================

// Get or create storefront slug
const getStorefrontSlug = async (req, res) => {
  try {
    const { userId } = req.params;
    const slug = await storefrontService.getOrCreateStorefrontSlug(userId);
    res.status(200).json({ success: true, slug });
  } catch (error) {
    console.error('Error getting storefront slug:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get available products for storefront (filtered by agent role)
const getAvailableProducts = async (req, res) => {
  try {
    const { userId } = req.params;
    const products = await storefrontService.getAvailableProducts(userId);
    res.status(200).json({ success: true, products });
  } catch (error) {
    console.error('Error getting available products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get agent's storefront products
const getAgentStorefrontProducts = async (req, res) => {
  try {
    const { userId } = req.params;
    const products = await storefrontService.getAgentStorefrontProducts(userId);
    res.status(200).json({ success: true, products });
  } catch (error) {
    console.error('Error getting agent storefront products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add product to storefront
const addProductToStorefront = async (req, res) => {
  try {
    const { userId } = req.params;
    const { productId, customPrice } = req.body;

    if (!productId || !customPrice) {
      return res.status(400).json({ success: false, message: 'Product ID and custom price are required' });
    }

    const product = await storefrontService.addProductToStorefront(userId, productId, customPrice);
    res.status(200).json({ success: true, product });
  } catch (error) {
    console.error('Error adding product to storefront:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update product price
const updateProductPrice = async (req, res) => {
  try {
    const { userId, productId } = req.params;
    const { customPrice } = req.body;

    if (!customPrice) {
      return res.status(400).json({ success: false, message: 'Custom price is required' });
    }

    const product = await storefrontService.updateStorefrontProductPrice(userId, productId, customPrice);
    res.status(200).json({ success: true, product });
  } catch (error) {
    console.error('Error updating product price:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Remove product from storefront
const removeProduct = async (req, res) => {
  try {
    const { userId, productId } = req.params;
    const result = await storefrontService.removeProductFromStorefront(userId, productId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error removing product:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Toggle product active status
const toggleProduct = async (req, res) => {
  try {
    const { userId, productId } = req.params;
    const product = await storefrontService.toggleStorefrontProduct(userId, productId);
    res.status(200).json({ success: true, product });
  } catch (error) {
    console.error('Error toggling product:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get agent's referral summary
const getAgentReferralSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    const summary = await storefrontService.getAgentReferralSummary(userId);
    res.status(200).json({ success: true, ...summary });
  } catch (error) {
    console.error('Error getting referral summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== PUBLIC STOREFRONT ====================

// Get public storefront by slug
const getPublicStorefront = async (req, res) => {
  try {
    const { slug } = req.params;
    const storefront = await storefrontService.getPublicStorefront(slug);
    res.status(200).json({ success: true, ...storefront });
  } catch (error) {
    console.error('Error getting public storefront:', error);
    res.status(404).json({ success: false, message: error.message });
  }
};

// Initialize referral payment
const initializeReferralPayment = async (req, res) => {
  try {
    const { slug } = req.params;
    const { storefrontProductId, customerName, customerPhone } = req.body;

    if (!storefrontProductId || !customerName || !customerPhone) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, customer name, and phone number are required'
      });
    }

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/store/${slug}?payment=callback`;
    const result = await storefrontService.initializeReferralPayment(
      slug,
      storefrontProductId,
      customerName,
      customerPhone,
      callbackUrl
    );

    res.status(200).json(result);
  } catch (error) {
    console.error('Error initializing referral payment:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Verify referral payment
const verifyReferralPayment = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference is required' });
    }

    const result = await storefrontService.verifyReferralPayment(reference);
    
    if (result.success) {
      res.status(200).json(result);
    } else if (result.pending) {
      res.status(202).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error verifying referral payment:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== ADMIN FUNCTIONS ====================

// Get all referral orders
const getAllReferralOrders = async (req, res) => {
  try {
    const filters = {
      agentId: req.query.agentId,
      paymentStatus: req.query.paymentStatus,
      commissionPaid: req.query.commissionPaid,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const result = await storefrontService.getAllReferralOrders(filters);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Error getting referral orders:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark commissions as paid
const markCommissionsPaid = async (req, res) => {
  try {
    const { agentId, orderIds, paymentMethod } = req.body;

    if (!agentId || !orderIds || !Array.isArray(orderIds)) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and order IDs array are required'
      });
    }

    // paymentMethod: 'wallet' (default) or 'momo'
    const result = await storefrontService.markCommissionsPaid(agentId, orderIds, paymentMethod || 'wallet');
    res.status(200).json(result);
  } catch (error) {
    console.error('Error marking commissions paid:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get weekly commission summary
const getWeeklyCommissionSummary = async (req, res) => {
  try {
    const summary = await storefrontService.getWeeklyCommissionSummary();
    res.status(200).json({ success: true, ...summary });
  } catch (error) {
    console.error('Error getting weekly commission summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Agent storefront management
  getStorefrontSlug,
  getAvailableProducts,
  getAgentStorefrontProducts,
  addProductToStorefront,
  updateProductPrice,
  removeProduct,
  toggleProduct,
  getAgentReferralSummary,
  
  // Public storefront
  getPublicStorefront,
  initializeReferralPayment,
  verifyReferralPayment,
  
  // Admin functions
  getAllReferralOrders,
  markCommissionsPaid,
  getWeeklyCommissionSummary
};
