import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { pool } from "../config/db";
import {verifyPassword} from "../utils/password";

export const hashToken = (token: string, salt: string) => scryptSync(token, salt, 64).toString("hex");

export const login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
        res.status(400).json({ success: false, message: "Email and password required" });
        return;
    }

    const result = await pool.query("SELECT id, password_hash, username, email FROM users WHERE email = $1", [email]);
    if ((result.rowCount ?? 0) === 0) {
        res.status(401).json({ success: false });
        return;
    }

    const user = result.rows[0];
    
    if (!verifyPassword(password, user.password_hash)) {
        res.status(401).json({ message: "passwords don't match", success: false });
        return;
    }

    const accessToken = jwt.sign({ userId: user.id }, process.env.ACCESS_SECRET as string, { expiresIn: "15m" });

    // add a small random id to each refresh token so multiple devices can coexist
    const refreshToken = jwt.sign({ userId: user.id, rid: randomBytes(8).toString("hex") }, process.env.REFRESH_SECRET as string, { expiresIn: "30d" });

    const salt = randomBytes(16).toString("hex");
    const tokenHash = hashToken(refreshToken, salt);

    await pool.query(
        "INSERT INTO refresh_tokens (user_id, token_hash, salt) VALUES ($1, $2, $3)",
        [user.id, tokenHash, salt]
    );

    res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true });
    
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = (req as any).cookies?.refreshToken as string | undefined;

    if (refreshToken) {
        // Find and delete the matching refresh_tokens row so this specific
        // session can never be used to mint a new accessToken again, even
        // if someone captured the cookie before logout.
        try {
            const payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as { userId: number };

            const sessions = await pool.query(
                "SELECT id, token_hash, salt FROM refresh_tokens WHERE user_id = $1",
                [payload.userId]
            );

            for (const row of sessions.rows) {
                const candidate = hashToken(refreshToken, row.salt);
                if (candidate === row.token_hash) {
                    await pool.query("DELETE FROM refresh_tokens WHERE id = $1", [row.id]);
                    break;
                }
            }
        } catch (err) {
            // Token invalid/expired — nothing to delete server-side, but
            // we still want to clear the cookies below regardless.
        }
    }

    res.clearCookie("accessToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
    });

    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
    });

    res.json({ success: true });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
    const refreshToken = (req as any).cookies?.refreshToken as string | undefined;

    if (!refreshToken) {
        res.sendStatus(401);
        return;
    }

    let payload: any;
    try {
        payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET as string) as any;
    } catch (err) {
        res.sendStatus(401);
        return;
    }

    const sessions = await pool.query("SELECT id, token_hash, salt FROM refresh_tokens WHERE user_id = $1", [payload.userId]);

    let valid = false;

    for (const row of sessions.rows) {
        const candidate = hashToken(refreshToken, row.salt);
        if (candidate === row.token_hash) {
            valid = true;
            break;
        }
    }

    if (!valid) {
        res.sendStatus(401);
        return;
    }

    const newAccessToken = jwt.sign({ userId: payload.userId }, process.env.ACCESS_SECRET as string, { expiresIn: "15m" });

    res.cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
    });

    res.sendStatus(200);
});
