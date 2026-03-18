const prisma = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');

class ChatService {
  // Get or create a conversation between two users
  async getOrCreateConversation(userA, userB) {
    const [participantA, participantB] = [Math.min(userA, userB), Math.max(userA, userB)];
    
    let conversation = await prisma.chatConversation.findUnique({
      where: { participantA_participantB: { participantA, participantB } }
    });

    if (!conversation) {
      conversation = await prisma.chatConversation.create({
        data: { participantA, participantB }
      });
    }

    return conversation;
  }

  // Send a message (encrypted)
  async sendMessage(conversationId, senderId, text, replyToId = null, forwardedFrom = null) {
    const { content, iv } = encrypt(text);

    const message = await prisma.chatMessage.create({
      data: {
        conversationId,
        senderId,
        content,
        iv,
        replyToId,
        forwardedFrom
      },
      include: {
        replyTo: {
          select: { id: true, senderId: true, content: true, iv: true, createdAt: true }
        }
      }
    });

    // Update conversation lastMessageAt
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() }
    });

    return this.decryptMessage(message);
  }

  // Get messages for a conversation with pagination
  async getMessages(conversationId, userId, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { conversationId },
        include: {
          replyTo: {
            select: { id: true, senderId: true, content: true, iv: true, createdAt: true, isDeleted: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.chatMessage.count({ where: { conversationId } })
    ]);

    // Mark unread messages as read
    await prisma.chatMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null
      },
      data: { readAt: new Date() }
    });

    return {
      messages: messages.reverse().map(m => this.decryptMessage(m)),
      total,
      hasMore: skip + limit < total
    };
  }

  // Get all conversations for a user with last message and unread count
  async getConversations(userId) {
    const conversations = await prisma.chatConversation.findMany({
      where: {
        OR: [
          { participantA: userId },
          { participantB: userId }
        ]
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (conversations.length === 0) return [];

    // Batch: collect all other participant IDs
    const otherUserIds = conversations.map(conv =>
      conv.participantA === userId ? conv.participantB : conv.participantA
    );
    const convIds = conversations.map(c => c.id);

    // Single query for all other users
    const [otherUsers, unreadCounts] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: otherUserIds } },
        select: { id: true, name: true, role: true, isLoggedIn: true }
      }),
      // Single query: group unread counts by conversationId
      prisma.chatMessage.groupBy({
        by: ['conversationId'],
        where: {
          conversationId: { in: convIds },
          senderId: { not: userId },
          readAt: null,
          isDeleted: false
        },
        _count: { id: true }
      })
    ]);

    const userMap = new Map(otherUsers.map(u => [u.id, u]));
    const unreadMap = new Map(unreadCounts.map(r => [r.conversationId, r._count.id]));

    return conversations.map((conv, i) => {
      const lastMessage = conv.messages[0] ? this.decryptMessage(conv.messages[0]) : null;
      return {
        id: conv.id,
        otherUser: userMap.get(otherUserIds[i]) || null,
        lastMessage,
        unreadCount: unreadMap.get(conv.id) || 0,
        lastMessageAt: conv.lastMessageAt,
        createdAt: conv.createdAt
      };
    });
  }

  // Get total unread message count for a user - single nested query
  async getUnreadCount(userId) {
    return prisma.chatMessage.count({
      where: {
        conversation: {
          OR: [
            { participantA: userId },
            { participantB: userId }
          ]
        },
        senderId: { not: userId },
        readAt: null,
        isDeleted: false
      }
    });
  }

  // Delete message (for me or for all)
  async deleteMessage(messageId, userId, forAll = false) {
    const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new Error('Message not found');

    if (forAll) {
      if (message.senderId !== userId) throw new Error('Can only delete your own messages for everyone');
      return prisma.chatMessage.update({
        where: { id: messageId },
        data: { isDeleted: true, deletedForAll: true, content: '', iv: '' }
      });
    }

    // Delete for me only — mark as deleted
    return prisma.chatMessage.update({
      where: { id: messageId },
      data: { isDeleted: true }
    });
  }

  // Mark messages as read
  async markAsRead(conversationId, userId) {
    return prisma.chatMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null
      },
      data: { readAt: new Date() }
    });
  }

  // Get all agents (for admin contact list)
  async getAllAgents() {
    return prisma.user.findMany({
      where: {
        role: { not: 'admin' },
        isSuspended: false
      },
      select: { id: true, name: true, role: true, email: true, isLoggedIn: true },
      orderBy: { name: 'asc' }
    });
  }

  // Get admin users (for agent contact list)
  async getAdmins() {
    return prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true, name: true, role: true, email: true, isLoggedIn: true },
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
    
    // Remove raw encrypted content from response
    delete decrypted.content;
    delete decrypted.iv;

    // Decrypt reply if exists
    if (decrypted.replyTo && !decrypted.replyTo.isDeleted) {
      if (decrypted.replyTo.content && decrypted.replyTo.iv) {
        decrypted.replyTo.decryptedContent = decrypt(decrypted.replyTo.content, decrypted.replyTo.iv);
      }
      delete decrypted.replyTo.content;
      delete decrypted.replyTo.iv;
    } else if (decrypted.replyTo?.isDeleted) {
      decrypted.replyTo.decryptedContent = '';
    }

    return decrypted;
  }
}

module.exports = new ChatService();
