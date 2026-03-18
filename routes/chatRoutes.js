const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');

// All chat routes require authentication
router.use(authMiddleware);

router.get('/conversations', chatController.getConversations);
router.get('/conversations/:otherUserId/messages', chatController.getMessages);
router.post('/conversations/:otherUserId/messages', chatController.sendMessage);
router.put('/conversations/:conversationId/read', chatController.markAsRead);
router.delete('/messages/:messageId', chatController.deleteMessage);
router.get('/unread-count', chatController.getUnreadCount);
router.get('/agents', chatController.getAgents);
router.get('/admins', chatController.getAdmins);
router.post('/forward', chatController.forwardMessage);

module.exports = router;
