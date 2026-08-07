import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { QueryResult } from "pg";
import { randomBytes, scryptSync } from "crypto";
import { pool } from "../config/db";
import Multer from "multer";
import { uploadAvatarToCloudinary } from "../utils/uploadAvatarToCloudinary";
import { hashPassword } from "../utils/password";

const trimString = (value?: string) => (typeof value === "string" ? value.trim() : undefined);

const parseUserId = (value: string | string[] | undefined): number => {
  if (!value) return NaN;
  const idText = Array.isArray(value) ? value[0] : value;
  return parseInt(idText, 10);
};

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const {
    username,
    email,
    password,
    display_name,
    bio,
    // avatar_url,
    bank_name,
    bank_account_number,
    bank_account_name,
    subaccount_code,
  } = req.body as Record<string, any>;

  const avatarFile = req.file as Express.Multer.File | undefined;; // Assuming you're using multer for file uploads

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

  const existingUser: QueryResult = await pool.query(
    "SELECT id FROM users WHERE username = $1 OR email = $2",
    [normalizedUsername, normalizedEmail]
  );

  if ((existingUser.rowCount ?? 0) > 0) {
    res.status(409).json({ success: false, message: "A user already exists with that username or email." });
    return;
  }

  if (!avatarFile) {
    res.status(400).json({ success: false, message: "No image file provided" });
    return;
  }

  const passwordHash = hashPassword(password);
  const avatar_url = await uploadAvatarToCloudinary(avatarFile, String(normalizedUsername));
  
  const result = await pool.query(
    `INSERT INTO users (
      username,
      email,
      password_hash,
      display_name,
      bio,
      avatar_url,
      bank_name,
      bank_account_number,
      bank_account_name,
      subaccount_code
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, username, email, display_name, bio, avatar_url, bank_name, bank_account_number, bank_account_name, subaccount_code, is_verified, created_at, updated_at`,
    [
      normalizedUsername,
      normalizedEmail,
      passwordHash,
      trimString(display_name),
      trimString(bio),
      trimString(avatar_url),
      trimString(bank_name),
      trimString(bank_account_number),
      trimString(bank_account_name),
      trimString(subaccount_code),
    ]
  );

  const user = result.rows[0];

  res.status(201).json({ success: true, user });
});

export const updateUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseUserId(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }

  const { display_name, bio } = req.body as Record<string, any>;
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

  if (updates.length === 0) {
    res.status(400).json({ success: false, message: "Provide display_name or bio to update." });
    return;
  }

  updates.push(`updated_at = NOW()`);
  values.push(userId);

  const result = await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${index} RETURNING id, username, email, display_name, bio, avatar_url, bank_name, bank_account_number, bank_account_name, subaccount_code, is_verified, created_at, updated_at`,
    values
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  res.json({ success: true, user: result.rows[0] });
});

export const updateUserBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = parseUserId(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }

  const { bank_name, bank_account_number, bank_account_name, subaccount_code } = req.body as Record<string, any>;
  const updates: string[] = [];
  const values: any[] = [];
  let index = 1;

  if (bank_name !== undefined) {
    updates.push(`bank_name = $${index++}`);
    values.push(trimString(bank_name));
  }
  if (bank_account_number !== undefined) {
    updates.push(`bank_account_number = $${index++}`);
    values.push(trimString(bank_account_number));
  }
  if (bank_account_name !== undefined) {
    updates.push(`bank_account_name = $${index++}`);
    values.push(trimString(bank_account_name));
  }
  if (subaccount_code !== undefined) {
    updates.push(`subaccount_code = $${index++}`);
    values.push(trimString(subaccount_code));
  }

  if (updates.length === 0) {
    res.status(400).json({ success: false, message: "Provide bank_name, bank_account_number, bank_account_name, or subaccount_code to update." });
    return;
  }

  updates.push(`updated_at = NOW()`);
  values.push(userId);

  const result = await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${index} RETURNING id, username, email, display_name, bio, avatar_url, bank_name, bank_account_number, bank_account_name, subaccount_code, is_verified, created_at, updated_at`,
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
