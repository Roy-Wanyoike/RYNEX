import { Router } from "express";
import { getUsers } from "../Controller/userRegistration";
import { verifyToken } from "../Middlewares/verifyToken";
import { requireAdmin } from "../Middlewares/requireAdmin";

const router = Router();

// GET /users – list all users (admin only)
// NOTE: the former POST /users route (plaintext-password duplicate
// registration endpoint) has been permanently removed.
router.get("", verifyToken, requireAdmin, getUsers);

export default router;
