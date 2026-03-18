const prisma = require("../config/db");

class ComplaintService {
  // Create a new complaint
  async createComplaint(data) {
    try {
      const { orderId, mobileNumber, whatsappNumber, message, complaintDate, complaintTime } = data;
      
      // Convert date string to ISO DateTime if provided
      let complaintDateTime = null;
      if (complaintDate) {
        if (complaintTime) {
          // Combine date and time into ISO DateTime
          complaintDateTime = new Date(`${complaintDate}T${complaintTime}:00`);
        } else {
          // Use date with default time
          complaintDateTime = new Date(`${complaintDate}T00:00:00`);
        }
      }
      
      const complaint = await prisma.complaint.create({
        data: {
          orderId: orderId || null,
          mobileNumber,
          whatsappNumber: whatsappNumber || null,
          message,
          complaintDate: complaintDateTime,
          complaintTime: complaintTime || null,
          status: 'pending'
        }
      });
      
      return complaint;
    } catch (error) {
      throw new Error(`Failed to create complaint: ${error.message}`);
    }
  }

  // Get all complaints (for admin)
  async getAllComplaints(status = null) {
    try {
      // Only add status filter if it's a valid non-empty string
      const whereClause = (status && status !== 'all' && status.trim() !== '') 
        ? { status: status.trim() } 
        : {};
      
      console.log('[ComplaintService] Fetching with whereClause:', JSON.stringify(whereClause));
      
      const complaints = await prisma.complaint.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' }
      });
      
      console.log('[ComplaintService] Found', complaints.length, 'complaints');
      return complaints;
    } catch (error) {
      console.error('[ComplaintService] Error fetching complaints:', error);
      throw new Error(`Failed to fetch complaints: ${error.message}`);
    }
  }

  // Get pending complaints count
  async getPendingCount() {
    try {
      const count = await prisma.complaint.count({
        where: { status: 'pending' }
      });
      
      return count;
    } catch (error) {
      throw new Error(`Failed to get pending count: ${error.message}`);
    }
  }

  // Get complaint by ID
  async getComplaintById(id) {
    try {
      const complaint = await prisma.complaint.findUnique({
        where: { id: parseInt(id) }
      });
      
      if (!complaint) {
        throw new Error('Complaint not found');
      }
      
      return complaint;
    } catch (error) {
      throw new Error(`Failed to fetch complaint: ${error.message}`);
    }
  }

  // Update complaint status
  async updateComplaintStatus(id, status, adminNotes = null) {
    try {
      const updateData = { status };
      if (adminNotes) {
        updateData.adminNotes = adminNotes;
      }
      
      const complaint = await prisma.complaint.update({
        where: { id: parseInt(id) },
        data: updateData
      });
      
      return complaint;
    } catch (error) {
      throw new Error(`Failed to update complaint: ${error.message}`);
    }
  }

  // Delete complaint
  async deleteComplaint(id) {
    try {
      await prisma.complaint.delete({
        where: { id: parseInt(id) }
      });
      
      return { message: 'Complaint deleted successfully' };
    } catch (error) {
      throw new Error(`Failed to delete complaint: ${error.message}`);
    }
  }

  // Get complaints by mobile number
  async getComplaintsByMobile(mobileNumber) {
    try {
      const complaints = await prisma.complaint.findMany({
        where: { mobileNumber },
        orderBy: { createdAt: 'desc' }
      });
      
      return complaints;
    } catch (error) {
      throw new Error(`Failed to fetch complaints: ${error.message}`);
    }
  }
}

module.exports = new ComplaintService();
