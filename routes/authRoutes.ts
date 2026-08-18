import { Router } from "express";
import { login, refreshToken, logout } from "../controllers/authController";

const router = Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/refresh", refreshToken);

export default router;
