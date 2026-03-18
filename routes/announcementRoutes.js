// routes/announcementRoutes.js
const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcementController');

// Middleware - replace these with your actual middleware
const authMiddleware = require('../middleware/authMiddleware'); // Your auth middleware
const adminMiddleware = require('../middleware/adminMiddleware'); // Your admin check middleware

// Public routes
router.get('/active', announcementController.getActiveAnnouncements);
router.get('/shop-alert', announcementController.getShopAlert);
router.get('/shop', announcementController.getShopAnnouncements);
router.get('/audience/:audience', announcementController.getAnnouncementsForAudience);
router.get('/unread/:audience', announcementController.getUnreadCount);
router.post('/read/:announcementId', announcementController.markAsRead);

// Protected routes (Admin only)
router.use(authMiddleware); // Apply auth middleware to all routes below
router.use(adminMiddleware); // Apply admin middleware to all routes below

router.get('/', announcementController.getAllAnnouncements);
router.get('/:id', announcementController.getAnnouncementById);
router.post('/', announcementController.createAnnouncement);
router.put('/:id', announcementController.updateAnnouncement);
router.patch('/:id/toggle', announcementController.toggleAnnouncementStatus);
router.delete('/:id', announcementController.deleteAnnouncement);

module.exports = router;