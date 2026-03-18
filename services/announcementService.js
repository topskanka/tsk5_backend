const prisma = require("../config/db");

class AnnouncementService {
  // Get all active announcements (for public display)
  async getActiveAnnouncements(target = null) {
    try {
      const whereClause = {
        isActive: true
      };
      
      // Filter by target if specified
      if (target) {
        whereClause.OR = [
          { target: target },
          { target: 'all' }
        ];
      }

      const announcements = await prisma.announcement.findMany({
        where: whereClause,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ]
      });
      return announcements;
    } catch (error) {
      throw new Error(`Failed to fetch active announcements: ${error.message}`);
    }
  }

  // Get announcements for a specific audience (agents)
  async getAnnouncementsForAudience(audience, userId = null) {
    try {
      const announcements = await prisma.announcement.findMany({
        where: {
          isActive: true,
          target: { notIn: ['shop', 'shop-alert'] },
          OR: [
            { targetAudience: audience.toLowerCase() },
            { targetAudience: 'all' }
          ]
        },
        include: {
          readBy: userId ? {
            where: { userId: parseInt(userId) }
          } : false
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ]
      });
      
      // Add isRead flag for each announcement
      return announcements.map(a => ({
        ...a,
        isRead: userId ? a.readBy?.length > 0 : false,
        readBy: undefined // Remove readBy from response
      }));
    } catch (error) {
      throw new Error(`Failed to fetch announcements for audience: ${error.message}`);
    }
  }

  // Mark announcement as read
  async markAsRead(announcementId, userId) {
    try {
      await prisma.notificationRead.upsert({
        where: {
          announcementId_userId: {
            announcementId,
            userId: parseInt(userId)
          }
        },
        update: {
          readAt: new Date()
        },
        create: {
          announcementId,
          userId: parseInt(userId)
        }
      });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to mark announcement as read: ${error.message}`);
    }
  }

  // Get unread count for a user
  async getUnreadCount(audience, userId) {
    try {
      const announcements = await prisma.announcement.findMany({
        where: {
          isActive: true,
          target: { notIn: ['shop', 'shop-alert'] },
          OR: [
            { targetAudience: audience.toLowerCase() },
            { targetAudience: 'all' }
          ]
        },
        select: { id: true }
      });
      
      const readAnnouncements = await prisma.notificationRead.findMany({
        where: {
          userId: parseInt(userId),
          announcementId: { in: announcements.map(a => a.id) }
        },
        select: { announcementId: true }
      });
      
      const readIds = new Set(readAnnouncements.map(r => r.announcementId));
      const unreadCount = announcements.filter(a => !readIds.has(a.id)).length;
      
      return unreadCount;
    } catch (error) {
      throw new Error(`Failed to get unread count: ${error.message}`);
    }
  }

  // Get shop alert (public - modal popup shown on every shop visit)
  async getShopAlert() {
    try {
      const alert = await prisma.announcement.findFirst({
        where: { isActive: true, target: 'shop-alert' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
      });
      return alert || null;
    } catch (error) {
      throw new Error(`Failed to fetch shop alert: ${error.message}`);
    }
  }

  // Get shop announcements (public - for shop page banner)
  async getShopAnnouncements() {
    try {
      const announcements = await prisma.announcement.findMany({
        where: {
          isActive: true,
          target: 'shop'
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ]
      });
      return announcements;
    } catch (error) {
      throw new Error(`Failed to fetch shop announcements: ${error.message}`);
    }
  }

  // Get all announcements (for admin dashboard)
  async getAllAnnouncements() {
    try {
      const announcements = await prisma.announcement.findMany({
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' }
        ]
      });
      return announcements;
    } catch (error) {
      throw new Error(`Failed to fetch announcements: ${error.message}`);
    }
  }

  // Create new announcement
  async createAnnouncement(data) {
    try {
      const { title, message, priority = 1, createdBy, target = 'login', targetAudience = 'all', isActive = true } = data;

      // Deactivate previous announcements only for shop-related types (shop alerts & shop banners)
      // Agent notifications should remain active until manually deactivated by admin
      if (isActive && (target === 'shop' || target === 'shop-alert')) {
        await prisma.announcement.updateMany({
          where: { 
            isActive: true,
            target: target,
            targetAudience: targetAudience
          },
          data: { isActive: false }
        });
      }

      // Create the new announcement
      const announcement = await prisma.announcement.create({
        data: {
          title,
          message,
          isActive: isActive,
          priority: parseInt(priority) || 1,
          createdBy: String(createdBy),
          target,
          targetAudience
        }
      });

      return announcement;
    } catch (error) {
      console.error('Create announcement error:', error);
      throw new Error(`Failed to create announcement: ${error.message}`);
    }
  }

  // Update announcement
  async updateAnnouncement(id, data) {
    try {
      const { title, message, isActive, priority } = data;

      
      const announcement = await prisma.announcement.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(message && { message }),
          ...(isActive !== undefined && { isActive }),
          ...(priority !== undefined && { priority })
        }
      });
      
      return announcement;
    } catch (error) {
      throw new Error(`Failed to update announcement: ${error.message}`);
    }
  }

  // Delete announcement
  async deleteAnnouncement(id) {
    try {
      await prisma.announcement.delete({
        where: { id }
      });
      return { message: 'Announcement deleted successfully' };
    } catch (error) {
      throw new Error(`Failed to delete announcement: ${error.message}`);
    }
  }

  // Get single announcement
  async getAnnouncementById(id) {
    try {
      const announcement = await prisma.announcement.findUnique({
        where: { id }
      });
      
      if (!announcement) {
        throw new Error('Announcement not found');
      }
      
      return announcement;
    } catch (error) {
      throw new Error(`Failed to fetch announcement: ${error.message}`);
    }
  }

  // Toggle announcement status
  async toggleAnnouncementStatus(id) {
    try {
      const announcement = await prisma.announcement.findUnique({
        where: { id }
      });
      
      if (!announcement) {
        throw new Error('Announcement not found');
      }
      
      const updated = await prisma.announcement.update({
        where: { id },
        data: {
          isActive: !announcement.isActive
        }
      });
      
      return updated;
    } catch (error) {
      throw new Error(`Failed to toggle announcement status: ${error.message}`);
    }
  }
}

module.exports = new AnnouncementService();