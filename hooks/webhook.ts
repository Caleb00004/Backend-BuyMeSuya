import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { pool } from "../config/db";
import { verifyFlutterwaveTransaction } from "../services/flutterwave";

/**
 * POST /webhooks/flutterwave
 *
 * Flutterwave sends this whenever a transaction's status changes.
 * DO NOT trust the payload directly — verify:
 *   1. The verif-hash header matches your configured secret hash
 *      (set in Flutterwave dashboard → Settings → Webhooks, NOT your
 *      API secret key — a separate value you choose yourself).
 *   2. Re-fetch the transaction from Flutterwave's API by id, and only
 *      trust THAT response for amount/status/currency.
 *
 * Idempotent: safe to receive the same webhook multiple times, since
 * we check current status before updating.
 */
export const handleFlutterwaveWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["verif-hash"];

  if (!signature || signature !== process.env.FLW_WEBHOOK_SECRET_HASH) {
    // Don't leak details about why — just reject.
    res.status(401).end();
    return;
  }

  const event = req.body;
  const transactionId = event?.data?.id;
  const txRef = event?.data?.tx_ref;

  if (!transactionId || !txRef) {
    // Acknowledge with 200 so Flutterwave doesn't keep retrying a
    // malformed payload forever, but don't process anything.
    res.status(200).json({ received: true, processed: false });
    return;
  }

  // Look up our own pending record first — if we don't recognize this
  // tx_ref at all, there's nothing to do (could be a stale/replayed event).
  const supportResult = await pool.query(
    "SELECT id, status, amount, creator_id FROM supports WHERE tx_ref = $1",
    [txRef]
  );

  if ((supportResult.rowCount ?? 0) === 0) {
    res.status(200).json({ received: true, processed: false });
    return;
  }

  const supportRecord = supportResult.rows[0];

  // Idempotency guard — already processed, nothing more to do.
  if (supportRecord.status === "successful" || supportRecord.status === "failed") {
    res.status(200).json({ received: true, processed: false, reason: "already processed" });
    return;
  }

  let verified;
  try {
    verified = await verifyFlutterwaveTransaction(transactionId);
  } catch (err) {
    // Flutterwave's API is unreachable/erroring — return 200 so they
    // retry the webhook later, but don't mark anything as final yet.
    res.status(200).json({ received: true, processed: false, reason: "verification failed" });
    return;
  }

  // Cross-check the verified data against what we recorded at
  // initiation time — protects against tampered amounts.
  const amountMatches = Number(verified.amount) === Number(supportRecord.amount);
  const txRefMatches = verified.txRef === txRef;

  if (!amountMatches || !txRefMatches || verified.status !== "successful") {
    await pool.query(
      `UPDATE supports SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [supportRecord.id]
    );
    res.status(200).json({ received: true, processed: true, result: "failed" });
    return;
  }

  await pool.query(
    `UPDATE supports SET status = 'successful', flw_ref = $1, updated_at = NOW() WHERE id = $2`,
    [verified.flwRef, supportRecord.id]
  );

  // TODO: trigger a notification to the creator here (email/push), and
  // any other post-payment side effects (e.g. updating a "total raised"
  // counter on the creator's profile).

  res.status(200).json({ received: true, processed: true, result: "successful" });
});