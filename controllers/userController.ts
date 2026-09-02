import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { QueryResult } from "pg";
import { randomBytes, scryptSync } from "crypto";
import { pool } from "../config/db";
import { verifyOtp } from "./otpController";
import jwt from "jsonwebtoken";
import { uploadAvatarToCloudinary } from "../utils/uploadAvatarToCloudinary";
import { hashPassword } from "../utils/password";

const trimString = (value?: string) => (typeof value === "string" ? value.trim() : undefined);

const parseUserId = (value: string | string[] | undefined): number => {
  if (!value) return NaN;
  const idText = Array.isArray(value) ? value[0] : value;
  return parseInt(idText, 10);
};

// verifies OTP and creates user.
export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { username, email, password, otp } = req.body as Record<string, any>;

  const normalizedUsername = trimString(username);
  const normalizedEmail = trimString(email)?.toLowerCase();

  if (!normalizedUsername) {
    res.status(400).json({ success: false, message: "Username is required." });
    return;
  }

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    res.status(400).json({ success: false, message: "A valid email is required." });
    return;
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ success: false, message: "Password is required and must be at least 8 characters." });
    return;
  }

  if (!otp) {
    res.status(400).json({ success: false, message: "OTP is required." });
    return;
  }

  const otpValid = await verifyOtp(normalizedEmail, String(otp));
  if (!otpValid) {
    res.status(400).json({ success: false, message: "Invalid or expired OTP." });
    return;
  }

  const existingUser: QueryResult = await pool.query(
    "SELECT id FROM users WHERE username = $1 OR email = $2",
    [normalizedUsername, normalizedEmail]
  );

  if ((existingUser.rowCount ?? 0) > 0) {
    res.status(409).json({ success: false, message: "A user already exists with that username or email." });
    return;
  }

  const passwordHash = hashPassword(password);

  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, display_name, bio, avatar_url,
       bank_name, bank_account_number, bank_account_name, subaccount_code,
       is_verified, created_at, updated_at`,
    [normalizedUsername, normalizedEmail, passwordHash]
  );

  const user = result.rows[0];

  const accessToken = jwt.sign({ userId: user.id }, process.env.ACCESS_SECRET as string, { expiresIn: "15m" });

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 15 * 60 * 1000,
  });

  res.status(201).json({ success: true, user });
});

export const checkUsername = asyncHandler(async (req: Request, res: Response) => {
  const { username } = req.params as { username?: string };

  const normalized = trimString(username);
  if (!normalized) {
    res.status(400).json({ success: false, message: "Username is required" });
    return;
  }

  const result: QueryResult = await pool.query("SELECT id FROM users WHERE username = $1", [normalized]);
  const taken = (result.rowCount ?? 0) > 0;

  res.json({ success: true, available: !taken });
});

// PUT
// update display name and bio
export const updateUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseUserId(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }

  const {
    display_name,
    bio,
    twitter_url,
    instagram_url,
    facebook_url,
    tiktok_url,
    youtube_url,
  } = req.body as Record<string, any>;
  const updates: string[] = [];
  const values: any[] = [];
  let index = 1;

  if (display_name !== undefined) {
    updates.push(`display_name = $${index++}`);
    values.push(trimString(display_name));
  }

  if (bio !== undefined) {
    updates.push(`bio = $${index++}`);
    values.push(trimString(bio));
  }

  const socialFields = [
    [twitter_url, "twitter_url"],
    [instagram_url, "instagram_url"],
    [facebook_url, "facebook_url"],
    [tiktok_url, "tiktok_url"],
    [youtube_url, "youtube_url"],
  ] as const;

  for (const [value, column] of socialFields) {
    if (value !== undefined) {
      // empty string clears the link — trimString turns "" into undefined,
      // so an explicit empty string still resolves to NULL in the DB
      updates.push(`${column} = $${index++}`);
      values.push(trimString(value) ?? null);
    }
  }

  if (updates.length === 0) {
    res.status(400).json({ success: false, message: "Provide at least one field to update.", });
    return;
  }

  updates.push(`updated_at = NOW()`);
  values.push(userId);

  const result = await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${index}
     RETURNING id, username, email, display_name, bio, avatar_url,
       bank_name, bank_account_number, bank_account_name, subaccount_code,
       twitter_url, instagram_url, facebook_url, tiktok_url, youtube_url,
       is_verified, created_at, updated_at`,
    values
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  res.json({ success: true, user: result.rows[0] });
});

export const updateUserAvatar = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseUserId(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }

  const { avatar_url } = req.body as Record<string, any>;

  if (avatar_url === undefined) {
    res.status(400).json({ success: false, message: "Provide avatar_url to update." });
    return;
  }

  const result = await pool.query(
    `UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, email, display_name, bio, avatar_url, bank_name, bank_account_number, bank_account_name, subaccount_code, is_verified, created_at, updated_at`,
    [trimString(avatar_url), userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  res.json({ success: true, user: result.rows[0] });
});

// -------------------- Public profile --------------------
 
/**
 * GET /users/:username
 * Public profile — safe, non-sensitive fields only, plus lightweight
 */
export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const rawUsername = req.params.username;
  const username = trimString(Array.isArray(rawUsername) ? rawUsername[0] : rawUsername);
 
  if (!username) {
    res.status(400).json({ success: false, message: "Username is required." });
    return;
  }
 
   const userResult: QueryResult = await pool.query(
    `SELECT id, username, display_name, bio, avatar_url,
      twitter_url, instagram_url, facebook_url, tiktok_url, youtube_url,
      is_verified, created_at
     FROM users WHERE username = $1`,
    [username]
  );
 
  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }
 
  const user = userResult.rows[0];
 
  // const statsResult: QueryResult = await pool.query(
  //   `SELECT
  //      COUNT(*)::int AS supporter_count,
  //      COALESCE(SUM(amount), 0)::numeric AS total_raised
  //    FROM supports
  //    WHERE creator_id = $1 AND status = 'successful'`,
  //   [user.id]
  // );
 
  // const stats = statsResult.rows[0];

  res.status(200).json({
    success: true,
    user: {
      ...user,
      // supporter_count: stats.supporter_count,
      // total_raised: stats.total_raised,
    },
  });
});

/*
GET /users/:id/me
 * Creator Dashboard 
 * aggregate stats (supporter count, total raised) computed on the fly.
*/
export const getMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const authenticatedUserId = (req as any).user.userId;

  if (Number.isNaN(authenticatedUserId) || authenticatedUserId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }

  const userResult: QueryResult = await pool.query(
    `SELECT id, username, email, display_name, bio, avatar_url,
      bank_name, bank_account_number, bank_code, bank_account_name, subaccount_code,
      twitter_url, instagram_url, facebook_url, tiktok_url, youtube_url,
      is_verified, created_at, updated_at
      FROM users WHERE id = $1`,
    [authenticatedUserId]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const user = userResult.rows[0];

  const statsResult: QueryResult = await pool.query(
    `SELECT
        COUNT(*)::int AS supporter_count,
        COALESCE(SUM(amount), 0)::numeric AS total_raised
      FROM supports
      WHERE creator_id = $1 AND status = 'successful'`,
    [authenticatedUserId]
  );

  const stats = statsResult.rows[0];

  res.status(200).json({
    success: true,
    user: {
      ...user,
      supporter_count: stats.supporter_count,
      total_raised: stats.total_raised,
    },
  });
});