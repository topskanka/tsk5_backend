const {
  addItemToCart,
  getUserCart,
  removeItemFromCart,
  getAllCarts,
  clearUserCart,
} = require("../services/cartService");

exports.addToCart = async (req, res) => {
  const { userId, productId, quantity, mobileNumber } = req.body;
  try {
    const item = await addItemToCart(userId, productId, quantity, mobileNumber);
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getCart = async (req, res) => {
  try {
    const cart = await getUserCart(parseInt(req.params.userId));
    res.json(cart);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    await removeItemFromCart(parseInt(req.params.cartItemId));
    res.json({ message: "Item removed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllCarts = async (req, res) => {
  try {
    const carts = await getAllCarts();
    res.json(carts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    await clearUserCart(parseInt(req.params.userId));
    res.json({ success: true, message: "Cart cleared successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
