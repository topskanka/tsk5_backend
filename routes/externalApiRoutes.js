const express = require('express');
const router = express.Router();
const externalApiController = require('../controllers/externalApiController');
const externalApiAuth = require('../middleware/externalApiAuth');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// ==================== PARTNER ENDPOINTS (API Key Auth) ====================
router.get('/products', externalApiAuth, externalApiController.getProducts);
router.post('/orders', externalApiAuth, externalApiController.createOrder);
router.get('/orders/:orderId', externalApiAuth, externalApiController.getOrderStatus);
router.post('/orders/status', externalApiAuth, externalApiController.getOrderStatuses);

// ==================== ADMIN ENDPOINTS (JWT Auth) ====================
router.post('/admin/keys', authMiddleware, adminMiddleware, externalApiController.createApiKey);
router.get('/admin/keys', authMiddleware, adminMiddleware, externalApiController.listApiKeys);
router.patch('/admin/keys/:id/revoke', authMiddleware, adminMiddleware, externalApiController.revokeApiKey);
router.patch('/admin/keys/:id/activate', authMiddleware, adminMiddleware, externalApiController.activateApiKey);
router.delete('/admin/keys/:id', authMiddleware, adminMiddleware, externalApiController.deleteApiKey);

module.exports = router;
