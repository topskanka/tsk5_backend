// controllers/announcementController.js
const announcementService = require('../services/announcementService');

class AnnouncementController {
  // Get active announcements for public use
  async getActiveAnnouncements(req, res) {
    try {
      const { target } = req.query;
      const announcements = await announcementService.getActiveAnnouncements(target);
      
      res.status(200).json({
        success: true,
        data: announcements,
        message: 'Active announcements fetched successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get announcements for a specific audience (agents)
  async getAnnouncementsForAudience(req, res) {
    try {
      const { audience } = req.params;
      const userId = req.query.userId || req.user?.id;
      
      const announcements = await announcementService.getAnnouncementsForAudience(audience, userId);
      
      res.status(200).json({
        success: true,
        data: announcements,
        message: 'Announcements fetched successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Mark announcement as read
  async markAsRead(req, res) {
    try {
      const { announcementId } = req.params;
      const userId = req.body.userId || req.user?.id;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }
      
      const result = await announcementService.markAsRead(announcementId, userId);
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'Announcement marked as read'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get unread count for a user
  async getUnreadCount(req, res) {
    try {
      const { audience } = req.params;
      const userId = req.query.userId || req.user?.id;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }
      
      const count = await announcementService.getUnreadCount(audience, userId);
      
      res.status(200).json({
        success: true,
        data: { unreadCount: count },
        message: 'Unread count fetched successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get active shop alert popup (public)
  async getShopAlert(req, res) {
    try {
      const alert = await announcementService.getShopAlert();
      res.status(200).json({ success: true, data: alert });
    } catch (error) {
      res.status(500).json({ success: false, data: null });
    }
  }

  // Get shop announcements (public)
  async getShopAnnouncements(req, res) {
    try {
      const announcements = await announcementService.getShopAnnouncements();
      res.status(200).json(announcements);
    } catch (error) {
      res.status(500).json([]);
    }
  }

  // Get all announcements (Admin only)
  async getAllAnnouncements(req, res) {
    try {
      const announcements = await announcementService.getAllAnnouncements();
      
      res.status(200).json({
        success: true,
        data: announcements,
        message: 'All announcements fetched successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Create new announcement (Admin only)
  async createAnnouncement(req, res) {
    try {
      const { title, message, isActive, priority, target, targetAudience } = req.body;
      const createdBy = req.user.id;
      
      if (!title || !message) {
        return res.status(400).json({
          success: false,
          message: 'Title and message are required'
        });
      }
      
      const announcementData = {
        title,
        message,
        isActive,
        priority,
        createdBy,
        target: target || 'login',
        targetAudience: targetAudience || 'all'
      };
      
      const announcement = await announcementService.createAnnouncement(announcementData);
      
      // Emit real-time update to all connected clients
      const io = req.app.get('io');
      if (io) io.emit('announcement:new', announcement);
      
      res.status(201).json({
        success: true,
        data: announcement,
        message: 'Announcement created successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Update announcement (Admin only)
  async updateAnnouncement(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const announcement = await announcementService.updateAnnouncement(id, updateData);
      
      const io = req.app.get('io');
      if (io) io.emit('announcement:new', announcement);
      
      res.status(200).json({
        success: true,
        data: announcement,
        message: 'Announcement updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Delete announcement (Admin only)
  async deleteAnnouncement(req, res) {
    try {
      const { id } = req.params;
      
      const result = await announcementService.deleteAnnouncement(id);
      
      const io = req.app.get('io');
      if (io) io.emit('announcement:new', { deleted: true, id });
      
      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get single announcement
  async getAnnouncementById(req, res) {
    try {
      const { id } = req.params;
      
      const announcement = await announcementService.getAnnouncementById(id);
      
      res.status(200).json({
        success: true,
        data: announcement,
        message: 'Announcement fetched successfully'
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  // Toggle announcement status (Admin only)
  async toggleAnnouncementStatus(req, res) {
    try {
      const { id } = req.params;
      
      const announcement = await announcementService.toggleAnnouncementStatus(id);
      
      const io = req.app.get('io');
      if (io) io.emit('announcement:new', announcement);
      
      res.status(200).json({
        success: true,
        data: announcement,
        message: `Announcement ${announcement.isActive ? 'activated' : 'deactivated'} successfully`
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new AnnouncementController();