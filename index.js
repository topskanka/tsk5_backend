require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const createUserRouter = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const cartRoutes = require('./routes/cartRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const topUpRoutes = require('./routes/topUpRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const salesRoutes = require('./routes/salesRoutes');
const smsRoutes = require('./routes/smsRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const pasteRoutes = require('./routes/pasteRoutes');
const resetRoutes = require('./routes/resetRoutes');
const shopRoutes = require('./routes/shopRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const complaintRoutes = require('./routes/complaintRoutes');
const storefrontRoutes = require('./routes/storefrontRoutes');
const chatRoutes = require('./routes/chatRoutes');
const shopChatRoutes = require('./routes/shopChatRoutes');
const externalApiRoutes = require('./routes/externalApiRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const userSockets = new Map();        // userId -> socketId
const socketUsers = new Map();        // socketId -> userId (reverse map for O(1) disconnect)
const MAX_SOCKET_CONNECTIONS = 500; // Limit for Railway memory constraints

io.on('connection', (socket) => {
  // Limit total connections to prevent memory issues
  if (userSockets.size >= MAX_SOCKET_CONNECTIONS) {
    socket.disconnect(true);
    return;
  }

  socket.on('register', (data) => {
    const userId = (typeof data === 'object' && data.userId) ? data.userId : data;
    if (userId) {
      userSockets.set(String(userId), socket.id);
      socketUsers.set(socket.id, String(userId));
    }
  });

  // Chat events
  socket.on('chat:send', (data) => {
    // Relay message to recipient in real-time
    const recipientSocketId = userSockets.get(data.recipientId) || userSockets.get(String(data.recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('chat:receive', data);
    }
  });

  socket.on('chat:typing', (data) => {
    const recipientSocketId = userSockets.get(data.recipientId) || userSockets.get(String(data.recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('chat:typing', { senderId: data.senderId, conversationId: data.conversationId });
    }
  });

  socket.on('chat:stop-typing', (data) => {
    const recipientSocketId = userSockets.get(data.recipientId) || userSockets.get(String(data.recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('chat:stop-typing', { senderId: data.senderId, conversationId: data.conversationId });
    }
  });

  socket.on('chat:read', (data) => {
    const recipientSocketId = userSockets.get(data.recipientId) || userSockets.get(String(data.recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('chat:read', { conversationId: data.conversationId, readBy: data.readBy });
    }
  });

  socket.on('chat:delete', (data) => {
    const recipientSocketId = userSockets.get(data.recipientId) || userSockets.get(String(data.recipientId));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('chat:delete', { messageId: data.messageId, forAll: data.forAll });
    }
  });

  // Shop chat events (phone-based identity, keys prefixed with "shop:")
  socket.on('shop-chat:register', (data) => {
    if (data.phone) {
      const key = `shop:${data.phone}`;
      userSockets.set(key, socket.id);
      socketUsers.set(socket.id, key);
    }
  });

  socket.on('shop-chat:send', (data) => {
    const recipientSocketId = userSockets.get(data.recipientKey) || userSockets.get(String(data.recipientKey));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('shop-chat:receive', data);
    }
  });

  socket.on('shop-chat:typing', (data) => {
    const recipientSocketId = userSockets.get(data.recipientKey) || userSockets.get(String(data.recipientKey));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('shop-chat:typing', { senderKey: data.senderKey, conversationId: data.conversationId });
    }
  });

  socket.on('shop-chat:stop-typing', (data) => {
    const recipientSocketId = userSockets.get(data.recipientKey) || userSockets.get(String(data.recipientKey));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('shop-chat:stop-typing', { senderKey: data.senderKey, conversationId: data.conversationId });
    }
  });

  socket.on('shop-chat:read', (data) => {
    const recipientSocketId = userSockets.get(data.recipientKey) || userSockets.get(String(data.recipientKey));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('shop-chat:read', { conversationId: data.conversationId });
    }
  });

  socket.on('shop-chat:delete', (data) => {
    const recipientSocketId = userSockets.get(data.recipientKey) || userSockets.get(String(data.recipientKey));
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('shop-chat:delete', { messageId: data.messageId, forAll: data.forAll });
    }
  });

  socket.on('disconnect', () => {
    const userId = socketUsers.get(socket.id);
    if (userId) {
      userSockets.delete(userId);
      socketUsers.delete(socket.id);
      io.emit('chat:user-status', { userId, isOnline: false });
    }
  });
});

module.exports = { app, io, userSockets, socketUsers };

app.set('io', io);
app.use(express.json());
app.use(cors());
app.use(helmet());

// Health check endpoint for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const userRoutes = createUserRouter(io, userSockets);
app.use('/api/users', userRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/cart', cartRoutes);
app.use('/products', productRoutes);
app.use('/order', orderRoutes);
app.use('/api', topUpRoutes);
app.use('/api', uploadRoutes);
app.use('/api', transactionRoutes);

app.use('/api/sales', salesRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/announcement', announcementRoutes);
app.use('/api/order', pasteRoutes);
app.use('/api/reset', resetRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/storefront', storefrontRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/shop-chat', shopChatRoutes);
app.use('/api/external', externalApiRoutes);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Tsk5 Server running on port ${PORT}`));

const paymentService = require('./services/paymentService');
const shopService = require('./services/shopService');

const reconcileOrphanedPayments = async () => {
  try {
    const orphanedPayments = await paymentService.getOrphanedSuccessfulPayments();
    
    if (orphanedPayments.length > 0) {
      console.log(`[Auto-Reconciliation] Found ${orphanedPayments.length} orphaned payments`);
      
      for (const payment of orphanedPayments) {
        try {
          const result = await paymentService.verifyAndCreateOrder(payment.externalRef, shopService);
          if (result.success && result.orderId) {
            console.log(`[Auto-Reconciliation] Created order ${result.orderId} for payment ${payment.externalRef}`);
          }
        } catch (err) {
          console.error(`[Auto-Reconciliation] Failed for ${payment.externalRef}:`, err.message);
        }
      }
    }
  } catch (error) {
    console.error('[Auto-Reconciliation] Error:', error.message);
  }
};

setInterval(reconcileOrphanedPayments, 5 * 60 * 1000);
setTimeout(reconcileOrphanedPayments, 30 * 1000);
