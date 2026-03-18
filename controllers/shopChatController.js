const shopChatService = require('../services/shopChatService');

class ShopChatController {
  // GET /api/shop-chat/admins - Get admin users for shop customers
  async getAdmins(req, res) {
    try {
      const admins = await shopChatService.getAdmins();
      res.json({ success: true, admins });
    } catch (error) {
      console.error('Error fetching admins:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/shop-chat/conversations?phone=xxx - Get conversations for a shop customer
  async getConversations(req, res) {
    try {
      const { phone } = req.query;
      if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });

      const conversations = await shopChatService.getConversationsByPhone(phone);
      res.json({ success: true, conversations });
    } catch (error) {
      console.error('Error fetching shop conversations:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/shop-chat/conversations/admin - Get all shop conversations for admin
  async getAdminConversations(req, res) {
    try {
      const adminId = req.user.id;
      const conversations = await shopChatService.getConversationsForAdmin(adminId);
      res.json({ success: true, conversations });
    } catch (error) {
      console.error('Error fetching admin shop conversations:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/shop-chat/conversations/:adminId/messages?phone=xxx - Get messages
  async getMessages(req, res) {
    try {
      const { adminId } = req.params;
      const { phone, page } = req.query;
      if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });

      const conversation = await shopChatService.getOrCreateConversation(phone, parseInt(adminId));
      const result = await shopChatService.getMessages(conversation.id, parseInt(page) || 1);
      res.json({ success: true, conversationId: conversation.id, ...result });
    } catch (error) {
      console.error('Error fetching shop messages:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // POST /api/shop-chat/conversations/:adminId/messages - Send a message from shop customer
  async sendMessage(req, res) {
    try {
      const { adminId } = req.params;
      const { phone, text, replyToId } = req.body;
      if (!phone || !text) return res.status(400).json({ success: false, message: 'Phone and text required' });

      const conversation = await shopChatService.getOrCreateConversation(phone, parseInt(adminId));
      const message = await shopChatService.sendMessage(conversation.id, 'customer', phone, text, replyToId || null);
      res.json({ success: true, message, conversationId: conversation.id });
    } catch (error) {
      console.error('Error sending shop message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // POST /api/shop-chat/conversations/:conversationId/admin-message - Send from admin (auth required)
  async sendAdminMessage(req, res) {
    try {
      const { conversationId } = req.params;
      const { text, replyToId } = req.body;
      const adminId = req.user.id;

      if (!text) return res.status(400).json({ success: false, message: 'Text required' });

      const message = await shopChatService.sendMessage(parseInt(conversationId), 'admin', adminId, text, replyToId || null);
      res.json({ success: true, message, conversationId: parseInt(conversationId) });
    } catch (error) {
      console.error('Error sending admin shop message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/shop-chat/conversations/:conversationId/messages-by-id - Get messages by conversation ID (admin)
  async getMessagesByConversationId(req, res) {
    try {
      const { conversationId } = req.params;
      const { page } = req.query;

      const result = await shopChatService.getMessages(parseInt(conversationId), parseInt(page) || 1);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Error fetching shop messages by id:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // PUT /api/shop-chat/conversations/:conversationId/read - Mark as read
  async markAsRead(req, res) {
    try {
      const { conversationId } = req.params;
      const { readerType } = req.body;

      await shopChatService.markAsRead(parseInt(conversationId), readerType || 'customer');
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking shop messages read:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // DELETE /api/shop-chat/messages/:messageId
  async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const { senderId, forAll } = req.body;

      await shopChatService.deleteMessage(parseInt(messageId), senderId, forAll);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting shop message:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/shop-chat/unread-count?phone=xxx
  async getUnreadCount(req, res) {
    try {
      const { phone } = req.query;
      if (!phone) return res.json({ success: true, count: 0 });

      const count = await shopChatService.getUnreadCountForCustomer(phone);
      res.json({ success: true, count });
    } catch (error) {
      console.error('Error fetching shop unread count:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // GET /api/shop-chat/admin-unread-count (auth required)
  async getAdminUnreadCount(req, res) {
    try {
      const adminId = req.user.id;
      const count = await shopChatService.getUnreadCountForAdmin(adminId);
      res.json({ success: true, count });
    } catch (error) {
      console.error('Error fetching admin shop unread count:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new ShopChatController();
