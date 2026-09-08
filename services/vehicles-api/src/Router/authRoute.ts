import { Router } from "express";
import { registerUser, login } from "../Controller/authController";

const authRouter = Router();

// Public authentication endpoints (no auth middleware)
authRouter.post("/register", registerUser);
authRouter.post("/login", login);

export default authRouter;
