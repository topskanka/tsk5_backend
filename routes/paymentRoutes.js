const express = require('express');
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

const router = express.Router();

// Public routes for shop payments (Paystack)

// Initialize Paystack payment
router.post('/initialize', paymentController.initializePayment);

// Paystack webhook callback (must stay public - called by Paystack servers)
router.post('/webhook', paymentController.handleWebhook);

// Verify payment status (called after redirect from Paystack)
router.post('/verify', paymentController.verifyPaymentStatus);

// Check payment status
router.get('/status/:externalRef', paymentController.checkStatus);

// Admin-only routes - REQUIRE AUTHENTICATION
router.get('/transactions', authMiddleware, adminMiddleware, paymentController.getAllTransactions);
router.get('/orphaned', authMiddleware, adminMiddleware, paymentController.getOrphanedPayments);
router.post('/reconcile', authMiddleware, adminMiddleware, paymentController.reconcilePayments);

module.exports = router;
