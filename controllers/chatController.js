const chatService = require('../services/chatService');
const prisma = require('../config/db');
const cache = require('../utils/cache');
const { decrypt } = require('../utils/encryption');

class ChatController {
  // GET /api/chat/conversations
  async getConversations(req, res) {
    try {
      const userId = req.user.id;
      const conversations = await chatService.getConversations(userId);
      res.json({ success: true, conversations });
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/chat/conversations/:otherUserId/messages?page=1
  async getMessages(req, res) {
    try {
      const userId = req.user.id;
      const otherUserId = parseInt(req.params.otherUserId);
      const page = parseInt(req.query.page) || 1;

      const conversation = await chatService.getOrCreateConversation(userId, otherUserId);
      const result = await chatService.getMessages(conversation.id, userId, page);

      res.json({ success: true, conversationId: conversation.id, ...result });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // POST /api/chat/conversations/:otherUserId/messages
  async sendMessage(req, res) {
    try {
      const userId = req.user.id;
      const otherUserId = parseInt(req.params.otherUserId);
      const { text, replyToId, forwardedFrom } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: 'Message text is required' });
      }

      const conversation = await chatService.getOrCreateConversation(userId, otherUserId);
      const message = await chatService.sendMessage(
        conversation.id, userId, text.trim(), replyToId || null, forwardedFrom || null
      );

      res.json({ success: true, message, conversationId: conversation.id });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // DELETE /api/chat/messages/:messageId
  async deleteMessage(req, res) {
    try {
      const userId = req.user.id;
      const messageId = parseInt(req.params.messageId);
      const { forAll } = req.body;

      await chatService.deleteMessage(messageId, userId, forAll);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // PUT /api/chat/conversations/:conversationId/read
  async markAsRead(req, res) {
    try {
      const userId = req.user.id;
      const conversationId = parseInt(req.params.conversationId);

      await chatService.markAsRead(conversationId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking as read:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/chat/unread-count
  async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;
      const cacheKey = `chat_unread_${userId}`;
      let count = cache.get(cacheKey);
      if (count === null) {
        count = await chatService.getUnreadCount(userId);
        cache.set(cacheKey, count, 10000); // 10 second cache matches polling interval
      }
      res.json({ success: true, count });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/chat/agents (admin only)
  async getAgents(req, res) {
    try {
      const agents = await chatService.getAllAgents();
      res.json({ success: true, agents });
    } catch (error) {
      console.error('Error fetching agents:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/chat/admins (for agents to see admin contacts)
  async getAdmins(req, res) {
    try {
      const admins = await chatService.getAdmins();
      res.json({ success: true, admins });
    } catch (error) {
      console.error('Error fetching admins:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // POST /api/chat/forward
  async forwardMessage(req, res) {
    try {
      const userId = req.user.id;
      const { messageId, targetUserIds } = req.body;

      if (!messageId || !targetUserIds || !targetUserIds.length) {
        return res.status(400).json({ success: false, message: 'messageId and targetUserIds required' });
      }

      const original = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!original || original.isDeleted) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }

      const originalText = decrypt(original.content, original.iv);
      const results = [];

      for (const targetUserId of targetUserIds) {
        const conversation = await chatService.getOrCreateConversation(userId, targetUserId);
        const msg = await chatService.sendMessage(conversation.id, userId, originalText, null, messageId);
        results.push({ targetUserId, message: msg, conversationId: conversation.id });
      }

      res.json({ success: true, forwarded: results });
    } catch (error) {
      console.error('Error forwarding message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new ChatController();
