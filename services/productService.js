const prisma = require("../config/db");

const addProduct = async (name, description, price, stock, promoPrice = null) => {
  return await prisma.product.create({
    data: { name, description, price, stock, promoPrice },
  });
};

const getAllProducts = async () => {
  return await prisma.product.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
};

const getProductById = async (id) => {
  return await prisma.product.findUnique({ where: { id } });
};

const updateProduct = async (id, data) => {
  return await prisma.product.update({ where: { id }, data });
};


const setProductStockToZero = async (id) => {
  return await prisma.product.update({
    where: { id },
    data: { stock: 0 },
  });
};

const setAllProductStockToZero = async (stockValue) => {
  return await prisma.product.updateMany({
    data: { stock: stockValue },
  });
};

// Get products visible in shop (includes out-of-stock products)
const getShopProducts = async () => {
  return await prisma.product.findMany({
    where: {
      showInShop: true
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

// Toggle product shop visibility
const toggleShopVisibility = async (id, showInShop) => {
  return await prisma.product.update({
    where: { id },
    data: { showInShop },
  });
};

const deleteProduct = async (id) => {
  return await prisma.$transaction(async (tx) => {
    // Delete related cart items
    await tx.cartItem.deleteMany({
      where: { productId: id }
    });
    
    // Delete related order items
    await tx.orderItem.deleteMany({
      where: { productId: id }
    });

    // Delete related referral orders
    await tx.referralOrder.deleteMany({
      where: { productId: id }
    });
    
    // Delete the product
    return await tx.product.delete({
      where: { id }
    });
  }, { timeout: 15000 });
};

const roleBasedPriceMap = {

};

/**
 * Get the correct price for a product based on user role.
 * @param {string} role - The user's role (e.g., 'AGENT', 'SUPERAGENT')
 * @param {object} product - Product object from DB
 * @returns {number} price
 */
const getPriceForUserRole = (role, product) => {
  if (!role || !product) return null;
  // If a mapping exists for this role and product, use it
  if (
    roleBasedPriceMap[role] &&
    roleBasedPriceMap[role][product.name]
  ) {
    return roleBasedPriceMap[role][product.name];
  }
  // Default to product.price from DB
  return product.price;
};

// Bulk update stock by carrier name filter using a single DB call
const bulkUpdateStockByCarrier = async (carrier, stockValue) => {
  return await prisma.product.updateMany({
    where: {
      name: { contains: carrier }
    },
    data: { stock: stockValue },
  });
};

// Bulk update shopStockClosed for all shop products
const bulkUpdateShopStock = async (closeStock) => {
  return await prisma.product.updateMany({
    where: { showInShop: true },
    data: { shopStockClosed: closeStock },
  });
};

// Toggle agent visibility for a single product
const toggleAgentVisibility = async (id, showForAgents) => {
  return await prisma.product.update({
    where: { id },
    data: { showForAgents },
  });
};

// Bulk update agent visibility - optionally filtered by carrier
const bulkUpdateAgentVisibility = async (showForAgents, carrier = null) => {
  const where = carrier ? { name: { contains: carrier } } : {};
  return await prisma.product.updateMany({
    where,
    data: { showForAgents },
  });
};

// Get products visible for agents
const getAgentProducts = async () => {
  return await prisma.product.findMany({
    where: {
      showForAgents: true,
    },
    orderBy: { createdAt: "desc" },
  });
};

// Toggle usePromoPrice for a single product
const togglePromoPrice = async (id, usePromoPrice) => {
  return await prisma.product.update({
    where: { id },
    data: { usePromoPrice },
  });
};

// Bulk switch between main and promo prices - optionally filtered by carrier
const bulkTogglePromoPrice = async (usePromoPrice, carrier = null) => {
  const where = carrier ? { name: { contains: carrier } } : {};
  return await prisma.product.updateMany({
    where,
    data: { usePromoPrice },
  });
};

module.exports = {
  addProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  setProductStockToZero,
  setAllProductStockToZero,
  getPriceForUserRole,
  getShopProducts,
  toggleShopVisibility,
  bulkUpdateStockByCarrier,
  bulkUpdateShopStock,
  toggleAgentVisibility,
  bulkUpdateAgentVisibility,
  getAgentProducts,
  togglePromoPrice,
  bulkTogglePromoPrice
};
