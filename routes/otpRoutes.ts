import { Router } from "express";
import rateLimit from "express-rate-limit";
import { sendOtp } from "../controllers/otpController";

const router = Router();

const sendLimiter = rateLimit({
  windowMs: 59 * 1000,
  max: 1,
  keyGenerator: (req) => (req.body && req.body.email) || req.ip,
  handler: (req, res) => res.status(429).json({ success: false, message: "Too many requests" }),
});

router.post("/send", sendLimiter, sendOtp);

export default router;
