const express = require('express');
const router = express.Router();
const shopChatController = require('../controllers/shopChatController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes (no auth - shop customers don't have accounts)
router.get('/admins', shopChatController.getAdmins);
router.get('/unread-count', shopChatController.getUnreadCount);
router.get('/conversations', shopChatController.getConversations);
router.delete('/messages/:messageId', shopChatController.deleteMessage);

// Admin routes (auth required) - MUST come before parameterized :adminId/:conversationId routes
router.get('/admin-unread-count', authMiddleware, shopChatController.getAdminUnreadCount);
router.get('/conversations/admin', authMiddleware, shopChatController.getAdminConversations);

// Parameterized routes (public for customer, auth for admin-specific)
router.get('/conversations/:conversationId/messages-by-id', authMiddleware, shopChatController.getMessagesByConversationId);
router.post('/conversations/:conversationId/admin-message', authMiddleware, shopChatController.sendAdminMessage);
router.put('/conversations/:conversationId/read', shopChatController.markAsRead);
router.get('/conversations/:adminId/messages', shopChatController.getMessages);
router.post('/conversations/:adminId/messages', shopChatController.sendMessage);

module.exports = router;
