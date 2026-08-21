import { Router } from "express";
import { login, refreshToken, logout, resetPassword, requestPasswordReset } from "../controllers/authController";
import rateLimit from "express-rate-limit";

const forgotPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3,
  keyGenerator: (req) => (req.body && req.body.email) || req.ip,
  handler: (req, res) => res.status(429).json({ success: false, message: "Too many requests" }),
});


const router = Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/refresh", refreshToken);
router.post("/forgot-password", forgotPasswordLimiter, requestPasswordReset);
router.post("/reset-password", resetPassword);

export default router;
