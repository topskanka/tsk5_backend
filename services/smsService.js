const prisma = require("../config/db");

class SmsService {
  // Save SMS message to database
  async saveSmsMessage(phoneNumber, message) {
    try {
      const parsedData = this.parseSmsMessage(message);
      
      const smsRecord = await prisma.smsMessage.create({
        data: {
          phoneNumber: phoneNumber,
          message: message,
          reference: parsedData.reference,
          amount: parsedData.amount,
          isProcessed: false
        }
      });
      
      return smsRecord;
    } catch (error) {
      console.error("Error saving SMS:", error);
      throw new Error(`Failed to save SMS: ${error.message}`);
    }
  }
  
  // Parse SMS message to extract reference and amount
  parseSmsMessage(message) {
    // Updated patterns for multiple SMS formats
    const patterns = {
      // Pattern for "Payment received for GHS X.XX"
      amountPattern1: /Payment received for GHS\s*([\d,]+\.?\d*)/i,
      // Pattern for "You have received GHS X.XX"
      amountPattern2: /You have received GHS\s*([\d,]+\.?\d*)/i,
      // Pattern for "Transaction ID: XXXXXXXXXX"
      transactionId: /Transaction ID:\s*(\d+)/i
    };
    
    const amountMatch1 = message.match(patterns.amountPattern1);
    const amountMatch2 = message.match(patterns.amountPattern2);
    const transactionIdMatch = message.match(patterns.transactionId);
    
    // Try both patterns to find amount
    let amount = null;
    let amountMatch = null;
    
    if (amountMatch1) {
      amountMatch = amountMatch1;
      amount = parseFloat(amountMatch1[1].replace(',', ''));
    } else if (amountMatch2) {
      amountMatch = amountMatch2;
      amount = parseFloat(amountMatch2[1].replace(',', ''));
    }
    
    // Log for debugging
    console.log('Parsing SMS:', message);
    console.log('Amount match (Pattern 1):', amountMatch1);
    console.log('Amount match (Pattern 2):', amountMatch2);
    console.log('Final amount:', amount);
    console.log('Transaction ID match:', transactionIdMatch);
    
    return {
      amount: amount,
      reference: transactionIdMatch ? transactionIdMatch[1] : null // Transaction ID goes to reference column
    };
  }
  
  // Get unprocessed SMS messages
  async getUnprocessedSms() {
    try {
      return await prisma.smsMessage.findMany({
        where: { isProcessed: false },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      console.error("Error fetching SMS:", error);
      throw new Error(`Failed to fetch SMS messages: ${error.message}`);
    }
  }
  
  // Find SMS by reference
  async findSmsByReference(reference) {
    try {
      return await prisma.smsMessage.findFirst({
        where: {
          reference: reference, // Remove toUpperCase() since it's numeric
          isProcessed: false
        }
      });
    } catch (error) {
      console.error("Error finding SMS by reference:", error);
      throw new Error(`Failed to find SMS by reference: ${error.message}`);
    }
  }

  // Find SMS by reference regardless of processed status.
  // Used by top-up verification so we can detect "already used" transaction IDs
  // and show the user when and for how much that ID was originally credited.
  async findSmsByReferenceAny(reference) {
    try {
      const cleanRef = String(reference).trim().replace(/[^a-zA-Z0-9]/g, '');
      if (!cleanRef) return null;

      // 1. Try exact match first
      let sms = await prisma.smsMessage.findFirst({
        where: { reference: cleanRef },
        orderBy: { createdAt: 'desc' }
      });
      if (sms) return sms;

      // 2. Try contains match
      sms = await prisma.smsMessage.findFirst({
        where: { reference: { contains: cleanRef } },
        orderBy: { createdAt: 'desc' }
      });
      if (sms) return sms;

      // 3. Try searching the raw message text
      sms = await prisma.smsMessage.findFirst({
        where: {
          message: { contains: cleanRef },
          amount: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (sms) return sms;

      return null;
    } catch (error) {
      console.error("Error finding SMS by reference (any):", error);
      throw new Error(`Failed to find SMS by reference: ${error.message}`);
    }
  }

  // Mark SMS as processed
  async markSmsAsProcessed(smsId, prismaTx = null) {
    const prismaClient = prismaTx || prisma;
    try {
      return await prismaClient.smsMessage.update({
        where: { id: smsId },
        data: { isProcessed: true },
      });
    } catch (error) {
      console.error("Error marking SMS as processed:", error);
      throw new Error(`Failed to mark SMS as processed: ${error.message}`);
    }
  }

  // Get payment received messages (updated to handle both formats)
  async getPaymentReceivedMessages(page = 1, limit = 50, search = null) {
    try {
      const where = {
        OR: [
          { message: { contains: "Payment received" } },
          { message: { contains: "You have received" } }
        ]
      };

      if (search) {
        where.AND = [
          {
            OR: [
              { phoneNumber: { contains: search } },
              { message: { contains: search } },
              { reference: { contains: search } }
            ]
          }
        ];
      }

      const skip = (page - 1) * limit;

      const [totalCount, messages] = await Promise.all([
        prisma.smsMessage.count({ where }),
        prisma.smsMessage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        })
      ]);

      return {
        data: messages,
        pagination: {
          page, limit, total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page < Math.ceil(totalCount / limit)
        }
      };
    } catch (error) {
      console.error("Error fetching payment messages:", error);
      throw new Error(`Failed to fetch payment messages: ${error.message}`);
    }
  }
}

module.exports = new SmsService();