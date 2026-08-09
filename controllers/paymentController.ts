import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../config/db";
import { initiateFlutterwavePayment } from "../services/flutterwave";

/**
 * POST /support/initiate
 * body: { creator_id, amount, fan_email, fan_name?, fan_phone? }
 *
 * Creates a pending "support" record and returns a Flutterwave
 * checkout link. The fan is redirected there to pay by card or
 * bank transfer — Flutterwave handles both, and the split to the
 * creator's subaccount happens automatically at settlement.
 *
 * This endpoint does NOT mark anything as paid — that only happens
 * once the webhook confirms it. Never trust the redirect alone.
 */
export const initiateSupport = asyncHandler(async (req: Request, res: Response) => {
  const { creator_id, amount, fan_email, fan_name, fan_phone } = req.body as {
    creator_id?: number;
    amount?: number;
    fan_email?: string;
    fan_name?: string;
    fan_phone?: string;
  };

  if (!creator_id || !amount || amount <= 0) {
    res.status(400).json({
      success: false,
      message: "creator_id and a positive amount are required.",
    });
    return;
  }

  if (!fan_email) {
    res.status(400).json({ success: false, message: "fan_email is required." });
    return;
  }

  const creatorResult = await pool.query(
    "SELECT id, username, subaccount_code FROM users WHERE id = $1",
    [creator_id]
  );

  if ((creatorResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "Creator not found." });
    return;
  }

  const creator = creatorResult.rows[0];

  if (!creator.subaccount_code) {
    res.status(422).json({
      success: false,
      message: "This creator hasn't finished setting up payouts yet.",
    });
    return;
  }

  const txRef = `support_${creator_id}_${randomUUID()}`;

  // Record the pledge as pending BEFORE calling Flutterwave, so tx_ref
  // is always traceable even if the redirect never completes.
  const insertResult = await pool.query(
    `INSERT INTO supports (tx_ref, creator_id, fan_email, amount, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING id`,
    [txRef, creator_id, fan_email, amount]
  );

  let payment;
  try {
    payment = await initiateFlutterwavePayment({
      txRef,
      amount,
      redirectUrl: `${process.env.APP_BASE_URL}/support/callback`,
      customerEmail: fan_email,
      customerName: fan_name,
      customerPhone: fan_phone,
      subaccountId: creator.subaccount_code,
      narration: `Support for ${creator.username}`,
    });
  } catch (err) {
    // Mark the pending record as failed to initiate rather than leaving
    // it dangling — makes it easy to spot/clean up in reporting later.
    await pool.query(`UPDATE supports SET status = 'init_failed' WHERE id = $1`, [
      insertResult.rows[0].id,
    ]);

    res.status(502).json({
      success: false,
      message: "Failed to initiate payment with Flutterwave.",
    });
    return;
  }

  res.status(200).json({
    success: true,
    payment_link: payment.paymentLink,
    tx_ref: txRef,
  });
});