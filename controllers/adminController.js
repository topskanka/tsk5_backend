const prisma = require("../prismaClient");

const addPackage = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Only admins can add packages" });
    }

    const { name, price } = req.body;
    const dataPackage = await prisma.dataPackage.create({
      data: { name, price, adminId: req.user.id },
    });

    res.status(201).json({ message: "Package added", dataPackage });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { addPackage };
