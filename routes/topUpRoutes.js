const express = require('express');
const router = express.Router();
const TopUpController = require('../controllers/topUpController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Initialize Paystack payment for wallet top-up (requires auth - user must be logged in)
router.post('/topup/initialize', authMiddleware, TopUpController.initializeTopup);

// Verify top-up using Transaction ID (SMS verification) (requires auth)
router.post('/verify-sms', authMiddleware, TopUpController.verifyTransactionId);

// Verify Paystack payment and credit wallet (requires auth)
router.post('/topup/verify', authMiddleware, TopUpController.verifyTopup);

// Paystack webhook for top-ups (must stay public - called by Paystack servers)
router.post('/topup/webhook', TopUpController.handleWebhook);

// Get all top-ups (admin only)
router.get('/topups', authMiddleware, adminMiddleware, TopUpController.getTopUps);

// Get user's top-up history (requires auth)
router.get('/topups/user/:userId', authMiddleware, TopUpController.getUserTopups);

// Delete a top-up record (admin only)
router.delete('/topups/:id', authMiddleware, adminMiddleware, TopUpController.deleteTopup);

module.exports = router;
