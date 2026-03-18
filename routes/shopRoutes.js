const express = require('express');
const shopController = require('../controllers/shopController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

const router = express.Router();

// Public routes
router.get('/products', shopController.getShopProducts);

// REMOVED: Direct order creation endpoint (POST /order)
// Orders are now ONLY created after verified Paystack payment via:
// - Payment webhook (POST /api/payment/webhook)
// - Payment verify (POST /api/payment/verify)
// This prevents free orders without payment.

// Track orders by mobile number (public - customers need this)
router.get('/track', shopController.trackOrders);

// Get all shop orders (admin only)
router.get('/orders', authMiddleware, adminMiddleware, shopController.getAllShopOrders);

module.exports = router;
