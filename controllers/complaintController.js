// controllers/complaintController.js
const complaintService = require('../services/complaintService');

class ComplaintController {
  // Create a new complaint (public - from shop)
  async createComplaint(req, res) {
    try {
      const { orderId, mobileNumber, whatsappNumber, message, complaintDate, complaintTime } = req.body;
      
      if (!mobileNumber || !message) {
        return res.status(400).json({
          success: false,
          message: 'Mobile number and message are required'
        });
      }
      
      const complaint = await complaintService.createComplaint({
        orderId,
        mobileNumber,
        whatsappNumber,
        message,
        complaintDate,
        complaintTime
      });
      
      console.log('Complaint created successfully:', complaint);
      
      // Emit real-time notification to admin
      try {
        const { io } = require('../index');
        io.emit('new-complaint', { complaintId: complaint.id, mobileNumber: complaint.mobileNumber });
      } catch (e) { /* socket emit is best-effort */ }

      res.status(201).json({
        success: true,
        data: complaint,
        message: 'Complaint submitted successfully'
      });
    } catch (error) {
      console.error('Error creating complaint:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get all complaints (Admin only)
  async getAllComplaints(req, res) {
    try {
      const { status } = req.query;
      // Normalize status: treat 'all', empty string, or undefined as null (fetch all)
      const normalizedStatus = (status && status !== 'all' && status.trim() !== '') 
        ? status.trim() 
        : null;
      
      console.log('[ComplaintController] Request status:', status, '-> normalized:', normalizedStatus);
      const complaints = await complaintService.getAllComplaints(normalizedStatus);
      console.log('[ComplaintController] Returning', complaints.length, 'complaints');
      
      res.status(200).json({
        success: true,
        data: complaints || [],
        message: 'Complaints fetched successfully'
      });
    } catch (error) {
      console.error('[ComplaintController] Error fetching complaints:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message
      });
    }
  }

  // Get pending complaints count (Admin only)
  async getPendingCount(req, res) {
    try {
      const count = await complaintService.getPendingCount();
      
      res.status(200).json({
        success: true,
        data: { count },
        message: 'Pending count fetched successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get complaint by ID (Admin only)
  async getComplaintById(req, res) {
    try {
      const { id } = req.params;
      const complaint = await complaintService.getComplaintById(id);
      
      res.status(200).json({
        success: true,
        data: complaint,
        message: 'Complaint fetched successfully'
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  // Update complaint status (Admin only)
  async updateComplaintStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;
      
      if (!status) {
        return res.status(400).json({
          success: false,
          message: 'Status is required'
        });
      }
      
      const complaint = await complaintService.updateComplaintStatus(id, status, adminNotes);
      
      res.status(200).json({
        success: true,
        data: complaint,
        message: 'Complaint updated successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Delete complaint (Admin only)
  async deleteComplaint(req, res) {
    try {
      const { id } = req.params;
      const result = await complaintService.deleteComplaint(id);
      
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

  // Get complaints by mobile number (public - for tracking)
  async getComplaintsByMobile(req, res) {
    try {
      const { mobileNumber } = req.params;
      const complaints = await complaintService.getComplaintsByMobile(mobileNumber);
      
      res.status(200).json({
        success: true,
        data: complaints,
        message: 'Complaints fetched successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new ComplaintController();
