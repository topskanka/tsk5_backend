const { getAllPackages } = require("../controllers/dataPackageController");

router.get("/packages", getAllPackages);
