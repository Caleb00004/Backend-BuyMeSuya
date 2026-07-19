import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import Waitlist from "../models/waitlistschema";

export const joinWaitlist = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };

    if (!email || typeof email !== "string" || !email.includes("@")) {
        res.status(400).json({ success: false, message: "A valid email is required." });
        return;
    }

    const existing = await Waitlist.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
        res.status(409).json({ success: false, message: "This email is already on the waitlist." });
        return;
    }

    await Waitlist.create({ email: email.toLowerCase().trim() });
    res.status(201).json({ success: true, message: "You're on the waitlist!" });
});

export const getWaitlist = asyncHandler(async (req: Request, res: Response) => {
    const { page = "1", limit = "50" } = req.query as Record<string, string>;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [entries, total] = await Promise.all([
        Waitlist.find().sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
        Waitlist.countDocuments(),
    ]);

    res.json({ entries, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
});
