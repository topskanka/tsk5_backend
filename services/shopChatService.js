const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { encrypt, decrypt } = require('../utils/encryption');

class ShopChatService {
  // Get or create a conversation between a shop customer (phone) and admin
  async getOrCreateConversation(customerPhone, adminId) {
    let conversation = await prisma.shopChatConversation.findUnique({
      where: { customerPhone_adminId: { customerPhone, adminId } }
    });

    if (!conversation) {
      conversation = await prisma.shopChatConversation.create({
        data: { customerPhone, adminId }
      });
    }

    return conversation;
  }

  // Send a message (encrypted)
  async sendMessage(conversationId, senderType, senderId, text, replyToId = null) {
    const { content, iv } = encrypt(text);

    const message = await prisma.shopChatMessage.create({
      data: {
        conversationId,
        senderType,
        senderId: String(senderId),
        content,
        iv,
        replyToId
      },
      include: {
        replyTo: {
          select: { id: true, senderType: true, senderId: true, content: true, iv: true, createdAt: true }
        }
      }
    });

    await prisma.shopChatConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() }
    });

    return this.decryptMessage(message);
  }

  // Get messages for a conversation with pagination
  async getMessages(conversationId, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      prisma.shopChatMessage.findMany({
        where: { conversationId },
        include: {
          replyTo: {
            select: { id: true, senderType: true, senderId: true, content: true, iv: true, createdAt: true }
          }
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit
      }),
      prisma.shopChatMessage.count({ where: { conversationId } })
    ]);

    return {
      messages: messages.map(m => this.decryptMessage(m)),
      total,
      hasMore: skip + messages.length < total
    };
  }

  // Get conversations for a shop customer by phone
  async getConversationsByPhone(customerPhone) {
    const conversations = await prisma.shopChatConversation.findMany({
      where: { customerPhone },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    return conversations.map(conv => {
      const lastMsg = conv.messages[0];
      return {
        id: conv.id,
        customerPhone: conv.customerPhone,
        adminId: conv.adminId,
        lastMessageAt: conv.lastMessageAt,
        lastMessage: lastMsg ? this.decryptMessage(lastMsg) : null,
        unreadCount: 0 // Will be calculated separately
      };
    });
  }

  // Get all shop conversations for admin
  async getConversationsForAdmin(adminId) {
    const conversations = await prisma.shopChatConversation.findMany({
      where: { adminId },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        _count: {
          select: {
            messages: {
              where: { senderType: 'customer', readAt: null }
            }
          }
        }
      }
    });

    return conversations.map(conv => {
      const lastMsg = conv.messages[0];
      return {
        id: conv.id,
        customerPhone: conv.customerPhone,
        displayName: `${conv.customerPhone} - Shop`,
        lastMessageAt: conv.lastMessageAt,
        lastMessage: lastMsg ? this.decryptMessage(lastMsg) : null,
        unreadCount: conv._count.messages
      };
    });
  }

  // Get unread count for a customer
  async getUnreadCountForCustomer(customerPhone) {
    const count = await prisma.shopChatMessage.count({
      where: {
        conversation: { customerPhone },
        senderType: 'admin',
        readAt: null
      }
    });
    return count;
  }

  // Get unread count for admin (all shop chats)
  async getUnreadCountForAdmin(adminId) {
    const count = await prisma.shopChatMessage.count({
      where: {
        conversation: { adminId },
        senderType: 'customer',
        readAt: null
      }
    });
    return count;
  }

  // Mark messages as read
  async markAsRead(conversationId, readerType) {
    const senderType = readerType === 'customer' ? 'admin' : 'customer';
    return prisma.shopChatMessage.updateMany({
      where: {
        conversationId,
        senderType,
        readAt: null
      },
      data: { readAt: new Date() }
    });
  }

  // Delete a message
  async deleteMessage(messageId, senderId, forAll = false) {
    const message = await prisma.shopChatMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new Error('Message not found');

    if (forAll) {
      return prisma.shopChatMessage.update({
        where: { id: messageId },
        data: { isDeleted: true, deletedForAll: true }
      });
    }

    if (String(message.senderId) !== String(senderId)) {
      throw new Error('Cannot delete another user\'s message');
    }

    return prisma.shopChatMessage.update({
      where: { id: messageId },
      data: { isDeleted: true }
    });
  }

  // Get admin users
  async getAdmins() {
    return prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true, name: true, role: true, isLoggedIn: true },
      orderBy: { name: 'asc' }
    });
  }

  // Decrypt a message object
  decryptMessage(message) {
    if (!message) return message;
    const decrypted = { ...message };

    if (message.isDeleted || message.deletedForAll) {
      decrypted.content = '';
      decrypted.decryptedContent = '';
    } else if (message.content && message.iv) {
      decrypted.decryptedContent = decrypt(message.content, message.iv);
    }

    if (message.replyTo) {
      decrypted.replyTo = this.decryptMessage(message.replyTo);
    }

    return decrypted;
  }
}

module.exports = new ShopChatService();
