const prisma = require('../config/db');
const { createTransaction } = require('./transactionService');


const addItemToCart = async (userId, productId, quantity, mobileNumber = null) => {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Product not found");
  if (product.stock <= 0) throw new Error("Product is out of stock");
  
  let cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId },
    });
  }
   
  // Calculate total price for this cart item using effective price (promo if active)
  const effectivePrice = (product.usePromoPrice && product.promoPrice != null) ? product.promoPrice : product.price;
  const totalPrice = effectivePrice * quantity;
  
  // Create cart item
  const cartItem = await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      productId,
      quantity,
      price: totalPrice,
      mobileNumber,
    },
  });
  
  return cartItem;
};

const getUserCart = async (userId) => {
  return await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  });
};

const removeItemFromCart = async (cartItemId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Get cart item details before deletion
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: cartItemId },
        include: {
          cart: true,
          product: true
        }
      });
      
      if (!cartItem) throw new Error("Cart item not found");
      
      // Delete the cart item
      const deletedItem = await prisma.cartItem.delete({ where: { id: cartItemId } });
      
      return deletedItem;
    } catch (error) {
      // P2025 = record not found (already deleted by submitCart)
      if (error.code === 'P2025') {
        return { id: cartItemId, deleted: true };
      }
      // Deadlock detected - retry after short delay
      const isDeadlock = error.message?.includes('deadlock') || error.code === 'P2034';
      if (isDeadlock && attempt < retries) {
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }
      throw error;
    }
  }
};


const getAllCarts = async () => {
  return await prisma.cart.findMany({
    include: {
      user: true,
      items: true,
    },
  });
};

const clearUserCart = async (userId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cart = await prisma.cart.findUnique({
        where: { userId },
      });

      if (!cart) {
        return { message: "Cart is already empty." };
      }

      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      return { message: "Cart cleared successfully." };
    } catch (error) {
      const isDeadlock = error.message?.includes('deadlock') || error.code === 'P2034';
      if (isDeadlock && attempt < retries) {
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }
      throw error;
    }
  }
};

module.exports = { addItemToCart, getUserCart, removeItemFromCart, getAllCarts, clearUserCart };
