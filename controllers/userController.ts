import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { QueryResult } from "pg";
import { randomBytes, scryptSync } from "crypto";
import { pool } from "../config/db";
import { verifyOtp } from "./otpController";
import Multer from "multer";
import jwt from "jsonwebtoken";
import { uploadAvatarToCloudinary } from "../utils/uploadAvatarToCloudinary";
import { hashPassword } from "../utils/password";
import { parsePagination, buildPaginationMeta } from "../utils/helpers";
import { hashToken } from "./authController";

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

  // // add a small random id to each refresh token so multiple devices can coexist
  // const refreshToken = jwt.sign({ userId: user.id, rid: randomBytes(8).toString("hex") }, process.env.REFRESH_SECRET as string, { expiresIn: "30d" });

  // const salt = randomBytes(16).toString("hex");
  // const tokenHash = hashToken(refreshToken, salt);

  // await pool.query(
  //     "INSERT INTO refresh_tokens (user_id, token_hash, salt) VALUES ($1, $2, $3)",
  //     [user.id, tokenHash, salt]
  // );

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
  });

  // res.cookie("refreshToken", refreshToken, {
  //   httpOnly: true,
  //   secure: process.env.NODE_ENV === "production",
  //   sameSite: "lax",
  //   maxAge: 30 * 24 * 60 * 60 * 1000,
  // });

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
 
// -------------------- Supporters list (paginated) --------------------
 
/**
 * GET /users/:username/supporters?page=1&limit=15
 * Public, paginated list of successful supporters. fan_email is
 * intentionally excluded — it's PII, not something a random visitor
 * to the profile page should see.
 */
export const getUserSupporters = asyncHandler(async (req: Request, res: Response) => {
 const rawUsername = req.params.username;
  const username = trimString(Array.isArray(rawUsername) ? rawUsername[0] : rawUsername);

  if (!username) {
    res.status(400).json({ success: false, message: "Username is required." });
    return;
  }

  const userResult: QueryResult = await pool.query(
    "SELECT id FROM users WHERE username = $1",
    [username]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const creatorId = userResult.rows[0].id;

  const supportersResult: QueryResult = await pool.query(
    `SELECT id, fan_name, notes, amount, created_at
     FROM supports
     WHERE creator_id = $1 AND status = 'successful'
     ORDER BY created_at DESC
     LIMIT 10`,
    [creatorId]
  );

  res.status(200).json({
    success: true,
    supporters: supportersResult.rows.map((row) => ({
      ...row,
      fan_name: row.fan_name?.trim() || "Anonymous",
    })),
  });
});

/**
 * GET /support/me?page=1&status=successful
 * Private — authenticated creator's OWN supports, all statuses
 * (pending, successful, failed, init_failed). Includes fan_email,
 * since only the creator viewing their own dashboard sees this —
 * unlike the public getUserSupporters endpoint, which deliberately
 * excludes it.
 */
export const getMySupports = asyncHandler(async (req: Request, res: Response) => {
  const creatorId = (req as any).user.userId;

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  // Optional status filter — validated against the known set so an
  // arbitrary/garbage value can't be used to build a broken query
  const allowedStatuses = ["successful", "failed"];
  const statusFilter =
    typeof req.query.status === "string" && allowedStatuses.includes(req.query.status)
      ? req.query.status
      : undefined;

  const whereClause = statusFilter
    ? "WHERE creator_id = $1 AND status = $2"
    : "WHERE creator_id = $1 AND status IN ('successful', 'failed')";
  const queryParams = statusFilter ? [creatorId, statusFilter] : [creatorId];

  const countResult: QueryResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM supports ${whereClause}`,
    queryParams
  );
  const total = countResult.rows[0].total;

  const supportsResult: QueryResult = await pool.query(
    `SELECT id, tx_ref, fan_name, fan_email, notes, amount, status, created_at, updated_at
     FROM supports
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${statusFilter ? "$3" : "$2"} OFFSET ${statusFilter ? "$4" : "$3"}`,
    [...queryParams, limit, offset]
  );

  res.status(200).json({
    success: true,
    supports: supportsResult.rows.map((row) => ({
      ...row,
      fan_name: row.fan_name?.trim() || "Anonymous",
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});
 
// -------------------- Top supporters --------------------
 
/**
 * GET /users/:username/top-supporters?page=1&limit=15
 * Supporters ranked by total amount given (aggregated across all
 * their successful support transactions to this creator), paginated.
 * Grouped by fan_email internally (the real identity key) but the
 * email itself is never returned — only the display name + totals.
 */
export const getTopSupporters = asyncHandler(async (req: Request, res: Response) => {
  const rawUsername = req.params.username;
  const username = trimString(Array.isArray(rawUsername) ? rawUsername[0] : rawUsername);
 
  if (!username) {
    res.status(400).json({ success: false, message: "Username is required." });
    return;
  }
 
  const userResult: QueryResult = await pool.query(
    "SELECT id FROM users WHERE username = $1",
    [username]
  );
 
  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }
 
  const creatorId = userResult.rows[0].id;
  const { page, limit, offset } = parsePagination(req.query);
 
  const countResult: QueryResult = await pool.query(
    `SELECT COUNT(DISTINCT fan_email)::int AS total
     FROM supports
     WHERE creator_id = $1 AND status = 'successful'`,
    [creatorId]
  );
  const total = countResult.rows[0].total;
 
  const topResult: QueryResult = await pool.query(
    `SELECT
       MAX(fan_name) AS fan_name,
       SUM(amount)::numeric AS total_amount,
       COUNT(*)::int AS support_count,
       MAX(created_at) AS last_supported_at
     FROM supports
     WHERE creator_id = $1 AND status = 'successful'
     GROUP BY fan_email
     ORDER BY total_amount DESC
     LIMIT $2 OFFSET $3`,
    [creatorId, limit, offset]
  );
 
  res.status(200).json({
    success: true,
    top_supporters: topResult.rows.map((row) => ({
      ...row,
      fan_name: row.fan_name?.trim() || "Anonymous",
    })),
    pagination: buildPaginationMeta(page, limit, total),
  });
});