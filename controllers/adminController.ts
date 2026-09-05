import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { pool } from "../config/db";

// GET /api/admin/users?page=1&search=caleb
// Paginated list of all users, with basic search by username/email
export const getAllUsers = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

  const whereClause = search ? "WHERE username ILIKE $1 OR email ILIKE $1" : "";
  const searchParam = search ? [`%${search}%`] : [];

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM users ${whereClause}`,
    searchParam
  );
  const total = countResult.rows[0].total;

  const usersResult = await pool.query(
    `SELECT id, username, email, display_name, is_verified,
      bank_name, subaccount_code, created_at
     FROM users
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${search ? "$2" : "$1"} OFFSET ${search ? "$3" : "$2"}`,
    [...searchParam, limit, offset]
  );

  res.json({
    success: true,
    users: usersResult.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/admin/users/:id
// Full detail on a single user, including their recent supports
export const getUserDetail = asyncHandler(async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }

  const userResult = await pool.query(
    `SELECT id, username, email, display_name, bio, avatar_url,
      bank_name, bank_code, bank_account_number, bank_account_name, subaccount_code,
      is_verified, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const supportsResult = await pool.query(
    `SELECT id, tx_ref, fan_name, amount, status, created_at
     FROM supports WHERE creator_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [userId]
  );

  res.json({
    success: true,
    user: userResult.rows[0],
    recent_supports: supportsResult.rows,
  });
});

// GET /api/admin/stats
// Platform-wide overview — total volume, platform's own cut, user/support counts
export const getAdminStats = asyncHandler(async (req: Request, res: Response) => {
  const usersResult = await pool.query("SELECT COUNT(*)::int AS total FROM users");

  const supportsResult = await pool.query(
    `SELECT
       COUNT(*)::int AS total_successful_supports,
       COALESCE(SUM(amount), 0)::numeric AS total_volume
     FROM supports
     WHERE status = 'successful'`
  );

  const pendingResult = await pool.query(
    `SELECT COUNT(*)::int AS total_pending FROM supports WHERE status = 'pending'`
  );

  res.json({
    success: true,
    stats: {
      total_users: usersResult.rows[0].total,
      total_successful_supports: supportsResult.rows[0].total_successful_supports,
      total_volume: supportsResult.rows[0].total_volume,
      total_pending_supports: pendingResult.rows[0].total_pending,
    },
  });
});

// DELETE /api/admin/supports/clear-pending
// Bulk-clears stale pending supports — a manual trigger for the same
// logic as your expireStaleSupports job, useful for on-demand cleanup
export const clearPendingSupports = asyncHandler(async (req: Request, res: Response) => {
  const olderThanMinutes = Number(req.query.olderThanMinutes) || 30;

  const result = await pool.query(
    `UPDATE supports
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '${olderThanMinutes} minutes'
     RETURNING id`
  );

  res.json({
    success: true,
    cleared_count: result.rowCount ?? 0,
  });
});

// PATCH /api/admin/supports/:id/status
// Manual override for a stuck support — e.g. the webhook silently
// failed and you've confirmed via Flutterwave's dashboard it actually succeeded
export const updateSupportStatus = asyncHandler(async (req: Request, res: Response) => {
  const supportId = Number(req.params.id);
  const { status } = req.body as { status?: string };

  const allowedStatuses = ["successful", "failed", "init_failed", "expired"];
  if (!status || !allowedStatuses.includes(status)) {
    res.status(400).json({ success: false, message: "A valid status is required." });
    return;
  }

   const existingResult = await pool.query(
    `SELECT status FROM supports WHERE id = $1`,
    [supportId]
  );

  if ((existingResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "Support not found." });
    return;
  }

  if (existingResult.rows[0].status !== "pending") {
    res.status(409).json({
      success: false,
      message: `Cannot update — support is already '${existingResult.rows[0].status}', not 'pending'.`,
    });
    return;
  }

  const result = await pool.query(
    `UPDATE supports SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, supportId]
  );

  res.json({ success: true, support: result.rows[0] });
});