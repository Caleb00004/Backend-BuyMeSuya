import { Router } from "express";
import rateLimit from "express-rate-limit";
import { joinWaitlist } from "../controllers/waitlistController";

const waitlistRoutes = Router();

const waitlistLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { success: false, message: "Too many waitlist attempts from this IP. Try again later." },
    standardHeaders: true,
    legacyHeaders: false,
});

waitlistRoutes.post("/", waitlistLimiter, joinWaitlist);

export default waitlistRoutes;
