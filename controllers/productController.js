const productService = require("../services/productService");

const addProduct = async (req, res) => {
  const { name, description, price, stock, promoPrice } = req.body;
  try {
    const product = await productService.addProduct(
      name,
      description,
      price,
      stock,
      promoPrice !== undefined ? promoPrice : null
    );
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const products = await productService.getAllProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProductById = async (req, res) => {
  try {
    const product = await productService.getProductById(
      parseInt(req.params.id)
    );
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const product = await productService.updateProduct(
      parseInt(req.params.id),
      req.body
    );
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'update', productId: product.id });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const setProductStockToZero = async (req, res) => {
  try {
    const product = await productService.setProductStockToZero(parseInt(req.params.id));
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'zero-stock', productId: product.id });
    res.json({ message: "Product stock set to zero", product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    await productService.deleteProduct(parseInt(req.params.id));
    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



const resetAllProductStock = async (req, res) => {
  const { stock } = req.body;

  if (typeof stock !== 'number' || stock < 0) {
    return res.status(400).json({ error: 'Stock must be a non-negative number' });
  }

  try {
    const result = await productService.setAllProductStockToZero(stock);
    // res.status(200).json({
    //   message: 'All product stocks have been set to 0.',
    //   updatedCount: result.count,
    // });
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'bulk-reset', stock });
    res.status(200).json({
      message: `All product stocks updated to ${stock}`,
      updatedCount: result.count,
    });
  } catch (error) {
    console.error('Error resetting product stock:', error);
    res.status(500).json({ error: 'Failed to reset product stock.' });
  }
};

// Get products visible in shop (public endpoint)
const getShopProducts = async (req, res) => {
  try {
    const products = await productService.getShopProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Toggle product shop visibility
const toggleShopVisibility = async (req, res) => {
  try {
    const { showInShop } = req.body;
    const product = await productService.toggleShopVisibility(
      parseInt(req.params.id),
      showInShop
    );
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



// Bulk update stock by carrier (single DB call instead of per-product)
const bulkUpdateStockByCarrier = async (req, res) => {
  const { carrier, stock } = req.body;
  if (!carrier || typeof stock !== 'number' || stock < 0) {
    return res.status(400).json({ error: 'Carrier and valid stock value are required' });
  }
  try {
    const result = await productService.bulkUpdateStockByCarrier(carrier, stock);
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'bulk-carrier', carrier, stock });
    res.json({ message: `${carrier} products stock set to ${stock}`, updatedCount: result.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Bulk update shop stock (open/close all)
const bulkUpdateShopStock = async (req, res) => {
  const { closeStock } = req.body;
  if (typeof closeStock !== 'boolean') {
    return res.status(400).json({ error: 'closeStock must be a boolean' });
  }
  try {
    const result = await productService.bulkUpdateShopStock(closeStock);
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'bulk-shop', closeStock });
    res.json({ message: closeStock ? 'All shop stock closed' : 'All shop stock opened', updatedCount: result.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Toggle agent visibility for a single product
const toggleAgentVisibility = async (req, res) => {
  try {
    const { showForAgents } = req.body;
    const product = await productService.toggleAgentVisibility(parseInt(req.params.id), showForAgents);
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'visibility', productId: product.id });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Bulk update agent visibility (optionally filtered by carrier)
const bulkUpdateAgentVisibility = async (req, res) => {
  const { showForAgents, carrier } = req.body;
  if (typeof showForAgents !== 'boolean') {
    return res.status(400).json({ error: 'showForAgents must be a boolean' });
  }
  try {
    const result = await productService.bulkUpdateAgentVisibility(showForAgents, carrier || null);
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'bulk-visibility', showForAgents, carrier });
    res.json({ message: `Agent visibility ${showForAgents ? 'enabled' : 'disabled'}${carrier ? ` for ${carrier}` : ' for all'}`, updatedCount: result.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get products visible for agents
const getAgentProducts = async (req, res) => {
  try {
    const products = await productService.getAgentProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Toggle promo price for a single product
const togglePromoPrice = async (req, res) => {
  try {
    const { usePromoPrice } = req.body;
    const product = await productService.togglePromoPrice(parseInt(req.params.id), usePromoPrice);
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'promo', productId: product.id });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Bulk switch between main and promo prices (optionally filtered by carrier)
const bulkTogglePromoPrice = async (req, res) => {
  const { usePromoPrice, carrier } = req.body;
  if (typeof usePromoPrice !== 'boolean') {
    return res.status(400).json({ error: 'usePromoPrice must be a boolean' });
  }
  try {
    const result = await productService.bulkTogglePromoPrice(usePromoPrice, carrier || null);
    const io = req.app.get('io');
    if (io) io.emit('product:stock-update', { type: 'bulk-promo', usePromoPrice, carrier });
    res.json({ message: `Switched to ${usePromoPrice ? 'promo' : 'main'} prices${carrier ? ` for ${carrier}` : ' for all'}`, updatedCount: result.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  addProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  setProductStockToZero,
  resetAllProductStock,
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
