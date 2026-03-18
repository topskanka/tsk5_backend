const prisma = require("../config/db");

const resetDatabase = async (req, res) => {
  try {
    // This is a dangerous operation - only allow for admin users
    const adminId = req.body.adminId;
    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required"
      });
    }

    // Verify the user is an admin
    const admin = await prisma.user.findUnique({
      where: { id: parseInt(adminId) }
    });

    if (!admin || admin.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: "Only administrators can perform this operation"
      });
    }

    // Start a transaction with extended timeout to ensure all operations complete or none do
    await prisma.$transaction(async (tx) => {
      console.log('Starting database reset transaction...');
      
      // Delete in order to respect foreign key constraints
      
      // 0. Delete shop chat messages first (references shop conversations)
      console.log('Deleting shop chat messages...');
      const deletedShopChatMessages = await tx.shopChatMessage.deleteMany({});
      console.log(`Deleted ${deletedShopChatMessages.count} shop chat messages`);
      
      // 0a. Delete shop chat conversations
      console.log('Deleting shop chat conversations...');
      const deletedShopChatConversations = await tx.shopChatConversation.deleteMany({});
      console.log(`Deleted ${deletedShopChatConversations.count} shop chat conversations`);
      
      // 0b. Delete chat messages (references conversations)
      console.log('Deleting chat messages...');
      const deletedChatMessages = await tx.chatMessage.deleteMany({});
      console.log(`Deleted ${deletedChatMessages.count} chat messages`);
      
      // 0c. Delete chat conversations
      console.log('Deleting chat conversations...');
      const deletedChatConversations = await tx.chatConversation.deleteMany({});
      console.log(`Deleted ${deletedChatConversations.count} chat conversations`);
      
      // 1. Delete commission payouts first (references referral orders and users)
      console.log('Deleting commission payouts...');
      const deletedCommissionPayouts = await tx.commissionPayout.deleteMany({});
      console.log(`Deleted ${deletedCommissionPayouts.count} commission payouts`);
      
      // 2. Delete referral orders (references users and products)
      console.log('Deleting referral orders...');
      const deletedReferralOrders = await tx.referralOrder.deleteMany({});
      console.log(`Deleted ${deletedReferralOrders.count} referral orders`);
      
      // 3. Delete storefront products (references users and products)
      console.log('Deleting storefront products...');
      const deletedStorefrontProducts = await tx.storefrontProduct.deleteMany({});
      console.log(`Deleted ${deletedStorefrontProducts.count} storefront products`);
      
      // 4. Delete order items (references orders)
      console.log('Deleting order items...');
      const deletedOrderItems = await tx.orderItem.deleteMany({});
      console.log(`Deleted ${deletedOrderItems.count} order items`);
      
      // 5. Delete orders (references users)
      console.log('Deleting orders...');
      const deletedOrders = await tx.order.deleteMany({});
      console.log(`Deleted ${deletedOrders.count} orders`);
      
      // 6. Delete cart items (references cart and products)
      console.log('Deleting cart items...');
      const deletedCartItems = await tx.cartItem.deleteMany({});
      console.log(`Deleted ${deletedCartItems.count} cart items`);
      
      // 7. Delete carts (references users)
      console.log('Deleting carts...');
      const deletedCarts = await tx.cart.deleteMany({});
      console.log(`Deleted ${deletedCarts.count} carts`);
      
      // 8. Delete transactions (references users)
      console.log('Deleting transactions...');
      const deletedTransactions = await tx.transaction.deleteMany({});
      console.log(`Deleted ${deletedTransactions.count} transactions`);
      
      // 9. Delete top-ups (references users)
      console.log('Deleting top-ups...');
      const deletedTopUps = await tx.topUp.deleteMany({});
      console.log(`Deleted ${deletedTopUps.count} top-ups`);
      
      // 10. Delete uploads (references users)
      console.log('Deleting uploads...');
      const deletedUploads = await tx.upload.deleteMany({});
      console.log(`Deleted ${deletedUploads.count} uploads`);
      
      // 11. Delete announcements
      console.log('Deleting announcements...');
      const deletedAnnouncements = await tx.announcement.deleteMany({});
      console.log(`Deleted ${deletedAnnouncements.count} announcements`);
      
      // 12. Delete SMS messages
      console.log('Deleting SMS messages...');
      const deletedSmsMessages = await tx.SmsMessage.deleteMany({});
      console.log(`Deleted ${deletedSmsMessages.count} SMS messages`);
      
      // 13. Delete payment transactions
      console.log('Deleting payment transactions...');
      const deletedPaymentTransactions = await tx.paymentTransaction.deleteMany({});
      console.log(`Deleted ${deletedPaymentTransactions.count} payment transactions`);
      
      // 14. Delete notification reads (references announcements)
      console.log('Deleting notification reads...');
      const deletedNotificationReads = await tx.notificationRead.deleteMany({});
      console.log(`Deleted ${deletedNotificationReads.count} notification reads`);
      
      // 15. Delete complaints
      console.log('Deleting complaints...');
      const deletedComplaints = await tx.complaint.deleteMany({});
      console.log(`Deleted ${deletedComplaints.count} complaints`);
      
      // 16. Delete purchases (references uploads)
      console.log('Deleting purchases...');
      const deletedPurchases = await tx.purchase.deleteMany({});
      console.log(`Deleted ${deletedPurchases.count} purchases`);
      
      console.log('Database reset transaction completed successfully');
      
      // Keep user table and product table completely untouched
    }, {
      timeout: 30000, // Increase timeout to 30 seconds
      maxWait: 35000, // Maximum time to wait for a transaction slot
    });

    res.status(200).json({
      success: true,
      message: "Database reset completed successfully. Users and products have been preserved, but all other data has been cleared."
    });

  } catch (error) {
    console.error("Database reset error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset database: " + error.message
    });
  }
};

module.exports = {
  resetDatabase
};
