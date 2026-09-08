import { Router } from "express";
import {
  addProductsToCart,
  getCart,
  addProducts,
  subtractProducts,
  getAllCart,
} from "../Controller/cartController";
import { verifyToken } from "../Middlewares/verifyToken";
import { requireAdmin } from "../Middlewares/requireAdmin";

const cartRoute = Router();

// Authenticated user cart operations
cartRoute.post("", verifyToken, addProductsToCart);
cartRoute.get("", verifyToken, getCart);
cartRoute.post("/add/:cardID", verifyToken, addProducts);
cartRoute.post("/subtract/:cardID", verifyToken, subtractProducts);

// Admin-only: view every user's cart
cartRoute.get("/all", verifyToken, requireAdmin, getAllCart);

export default cartRoute;
