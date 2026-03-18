const prisma = require("../config/db");

const passService = async (userId, newPassword) => {
    try {
        // Ensure userId is a valid number
        if (isNaN(userId)) {
            throw new Error("Invalid user ID");
        }

        const user = await prisma.user.update({
            where: { id: Number(userId) }, // Ensures userId is a number
            data: { password: newPassword }, // Update only password
        });

        return user;
    } catch (error) {
        throw new Error("Error updating user: " + error.message);
    }
};

module.exports = { passService };
