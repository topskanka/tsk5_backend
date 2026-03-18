// Admin check middleware
module.exports = (req, res, next) => {
  if (req.user && req.user.role?.toUpperCase() === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Admin access required.' });
  }
};
