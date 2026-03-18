const express = require('express');
const router = express.Router();
const storefrontController = require('../controllers/storefrontController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ==================== AGENT STOREFRONT MANAGEMENT (requires auth) ====================

router.get('/agent/:userId/slug', authMiddleware, storefrontController.getStorefrontSlug);
router.get('/agent/:userId/products/available', authMiddleware, storefrontController.getAvailableProducts);
router.get('/agent/:userId/products', authMiddleware, storefrontController.getAgentStorefrontProducts);
router.post('/agent/:userId/products', authMiddleware, storefrontController.addProductToStorefront);
router.put('/agent/:userId/products/:productId', authMiddleware, storefrontController.updateProductPrice);
router.delete('/agent/:userId/products/:productId', authMiddleware, storefrontController.removeProduct);
router.patch('/agent/:userId/products/:productId/toggle', authMiddleware, storefrontController.toggleProduct);
router.get('/agent/:userId/referrals', authMiddleware, storefrontController.getAgentReferralSummary);

// ==================== PUBLIC STOREFRONT (no auth - customers access these) ====================

router.get('/public/:slug', storefrontController.getPublicStorefront);
router.post('/public/:slug/pay', storefrontController.initializeReferralPayment);
router.post('/verify', storefrontController.verifyReferralPayment);

// ==================== ADMIN FUNCTIONS (requires admin auth) ====================

router.get('/admin/referrals', authMiddleware, adminMiddleware, storefrontController.getAllReferralOrders);
router.post('/admin/commissions/pay', authMiddleware, adminMiddleware, storefrontController.markCommissionsPaid);
router.get('/admin/commissions/weekly', authMiddleware, adminMiddleware, storefrontController.getWeeklyCommissionSummary);

module.exports = router;
