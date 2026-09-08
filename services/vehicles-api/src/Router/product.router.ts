import { Router } from "express";
import {
  addProducts,
  getProducts,
  getCarsBodyShape,
  getCarBrand,
  getOneCarProduct,
  softDeleteProduct,
} from "../Controller/products";
import { verifyToken } from "../Middlewares/verifyToken";
import { requireAdmin } from "../Middlewares/requireAdmin";

const productRoute = Router();

// Admin-only product management
productRoute.post("", verifyToken, requireAdmin, addProducts);
productRoute.post(
  "/softdeletecar/:carId",
  verifyToken,
  requireAdmin,
  softDeleteProduct
);

// Public catalogue reads
productRoute.get("/getproducts", getProducts);
productRoute.get("/getcarbodyshape/:bodyType", getCarsBodyShape);
productRoute.get("/getcarbrand/:brand", getCarBrand);
productRoute.get("/getonecar/:carId", getOneCarProduct);

export default productRoute;
