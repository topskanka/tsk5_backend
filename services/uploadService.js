const prisma = require("../config/db");

// Fetch all uploaded files
const getAllUploads = async () => {
  return await prisma.upload.findMany({
    orderBy: {
      id: "desc",  // Sorts by createdAt in descending order
    },
  });
};

// Fetch uploaded files by user ID
const getUserUploads = async (userId) => {
  return await prisma.upload.findMany({
    where: { userId: Number(userId) },
  });
};

module.exports = {
  getAllUploads,
  getUserUploads,
};
