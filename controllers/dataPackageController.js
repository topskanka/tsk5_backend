const prisma = require('../config/db');

const getAllPackages = async (req, res) => {
    try {
      const packages = await prisma.dataPackage.findMany();
      res.status(200).json(packages);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  };
  
  module.exports = { getAllPackages };
