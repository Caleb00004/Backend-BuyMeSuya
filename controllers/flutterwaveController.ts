import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../config/db";
import { QueryResult } from "pg";
import {
  createFlutterwaveSubaccount,
  initiateFlutterwavePayment,
  updateFlutterwaveSubaccount,
  verifyFlutterwaveTransaction,
} from "../services/flutterwave";
import { sendBankDetailsUpdatedEmail, sendTipNotificationEmail } from "../utils/send_email";

export const fetchBanks = asyncHandler(async (req: Request, res: Response) => {
  try {
    const response = await fetch(
    'https://api.flutterwave.com/v3/banks/NG?include_provider_type=1',
    {
        headers: {
        Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        'Content-Type': 'application/json',
        },
    }
    );
    const json = await response.json();
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch banks' });
  }
})

export const resolveBankName = asyncHandler(async (req: Request, res: Response) => {
  const { bank_code, account_number } = req.body as {
    bank_code?: string;
    account_number?: string;
  };

  if (!bank_code || !account_number) {
    res.status(400).json({
      status: 'error',
      message: 'bank_code and account_number are required',
    });
    return;
  }

  const url = 'https://api.flutterwave.com/v3/accounts/resolve';
  const options = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      account_number,
      account_bank: bank_code,
    }),
  };

  const flwResponse = await fetch(url, options);
  const json = await flwResponse.json();

  if (!flwResponse.ok || json.status !== 'success') {
    res.status(422).json({
      status: 'error',
      message: json.message ?? 'Could not resolve account details',
    });
    return;
  }

  res.status(200).json({
    status: 'success',
    data: {
      accountNumber: json.data.account_number,
      accountName: json.data.account_name,
    },
  });
  return;
});


/**
 * Step 2 of the bank-onboarding flow: called AFTER the user has seen
 * the resolved account_name (from resolveBankName) and confirmed it.
 *
 * This is the endpoint that actually creates the Flutterwave subaccount
 * and persists everything to the users table. It re-resolves the account
 * server-side rather than trusting whatever the client sends back for
 * account_name, so a tampered request can't set an unverified name.
 *
 * ⚠️ TODO: this MUST be behind auth, checking req.user.id === userId
 * (or an admin override) before this lands in production — see the
 * earlier note on updateUserProfile/updateUserBankDetails.
 */
export const confirmBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const userId = Number(req.params.id);
  if (Number.isNaN(userId) || userId <= 0) {
    res.status(400).json({ success: false, message: "A valid user id is required." });
    return;
  }
 
  const { bank_code, account_number, business_mobile, bank_name } = req.body as {
    bank_name?: string;
    bank_code?: string;
    account_number?: string;
    business_mobile?: string;
  };
 
  if (!bank_code || !account_number || !business_mobile || !bank_name) {
    res.status(400).json({
      success: false,
      message: "bank_code, account_number, bank_name and business_mobile are required.",
    });
    return;
  }
 
  // Re-resolve server-side — never trust a client-supplied account_name
  const resolveResponse = await fetch("https://api.flutterwave.com/v3/accounts/resolve", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ account_number, account_bank: bank_code }),
  });
  const resolveJson = await resolveResponse.json();
 
  if (!resolveResponse.ok || resolveJson.status !== "success") {
    res.status(422).json({
      success: false,
      message: resolveJson.message ?? "Could not verify account details.",
    });
    return;
  }

  const userResult: QueryResult = await pool.query(
    `SELECT id, username, email, display_name, bio, avatar_url, is_verified, subaccount_code, created_at
      FROM users WHERE id = $1`,
    [userId]
  );

  if ((userResult.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const user = userResult.rows[0];
  const verifiedAccountName: string = resolveJson.data.account_name;
  const existingSubaccountCode = userResult.rows[0]?.subaccount_code;
 
  let subaccount;
  try {
     if (existingSubaccountCode) {
      subaccount = await updateFlutterwaveSubaccount(existingSubaccountCode, {
        accountBank: bank_code,
        accountNumber: account_number,
        businessName: verifiedAccountName,
        businessMobile: business_mobile,
        businessEmail: user.email
      });
    } else {
      subaccount = await createFlutterwaveSubaccount({
        accountBank: bank_code,
        accountNumber: account_number,
        businessName: verifiedAccountName,
        businessMobile: business_mobile,
        businessEmail: user.email,
      });
    }
  } catch (err) {
    console.error(err)
    res.status(502).json({
      success: false,
      message: "Failed to set up payout account with Flutterwave.",
    });
    return;
  }
 
  const result = await pool.query(
    `UPDATE users SET
      bank_name = $1,
      bank_code = $2,
      bank_account_number = $3,
      bank_account_name = $4,
      subaccount_code = $5,
      updated_at = NOW()
    WHERE id = $6
    RETURNING id, username, email, display_name, bio, avatar_url,
      bank_name, bank_code, bank_account_number, bank_account_name, subaccount_code,
      is_verified, created_at, updated_at`,
    [bank_name, bank_code, account_number, verifiedAccountName, subaccount.subaccountId, userId]
  );
 
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  const updatedUser = result.rows[0];

  // Send a security notification — isolate this so an email failure
  // never breaks the actual bank-update response
  try {
    await sendBankDetailsUpdatedEmail(
      updatedUser.email,
      updatedUser.display_name || updatedUser.username,
      verifiedAccountName,
      bank_code
    );
  } catch (err) {
    console.error("Failed to send bank details update notification:", err);
  }
 
  res.status(200).json({ success: true, user: result.rows[0] });
});


/**
 * POST /support/initiate
 * body: { creator_id, amount, fan_email, fan_name?, fan_phone?, notes? }
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
  const { creator_id, amount, fan_email, fan_name, fan_phone, notes } = req.body as {
    creator_id?: number;
    amount?: number;
    fan_email?: string;
    fan_name?: string;
    fan_phone?: string;
    notes?: string;
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
    `INSERT INTO supports (tx_ref, creator_id, fan_email, fan_name, notes, amount, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
     RETURNING id`,
    [txRef, creator_id, fan_email, fan_name, notes, amount]
  );

  let payment;
  try {
    payment = await initiateFlutterwavePayment({
      txRef,
      amount,
      redirectUrl: `${process.env.APP_BASE_URL}/${creator.username}`,
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
  console.log("[webhook] Incoming request received");

  const signature = req.headers["verif-hash"];

  if (!signature || signature !== process.env.FLW_WEBHOOK_SECRET_HASH) {
    console.error("[webhook] Signature mismatch — rejecting. Received:", signature);
    res.status(401).end();
    return;
  }

  console.log("[webhook] Signature verified OK");

  const event = req.body;
  const transactionId = event?.data?.id;
  const txRef = event?.data?.tx_ref;
  console.log("[webhook] Payload parsed — transactionId:", transactionId, "txRef:", txRef);

  if (!transactionId || !txRef) {
    console.error("[webhook] Malformed payload — missing transactionId or txRef. Raw body:", JSON.stringify(event));
    res.status(200).json({ received: true, processed: false });
    return;
  }

  const supportResult = await pool.query(
    "SELECT id, status, amount, creator_id FROM supports WHERE tx_ref = $1",
    [txRef]
  );

  if ((supportResult.rowCount ?? 0) === 0) {
    console.error("[webhook] No matching support record found for txRef:", txRef);
    res.status(200).json({ received: true, processed: false });
    return;
  }

  const supportRecord = supportResult.rows[0];
  console.log("[webhook] Matched support record:", {
    id: supportRecord.id,
    currentStatus: supportRecord.status,
    amount: supportRecord.amount,
    creatorId: supportRecord.creator_id,
  });

  if (supportRecord.status === "successful" || supportRecord.status === "failed") {
    console.log("[webhook] Already processed (status:", supportRecord.status, ") — skipping. Likely a duplicate/retried webhook delivery.");
    res.status(200).json({ received: true, processed: false, reason: "already processed" });
    return;
  }

  console.log("[webhook] Calling verifyFlutterwaveTransaction for transactionId:", transactionId);

  let verified;
  try {
    verified = await verifyFlutterwaveTransaction(transactionId);
    console.log("[webhook] Verification succeeded:", {
      status: verified.status,
      amount: verified.amount,
      txRef: verified.txRef,
      flwRef: verified.flwRef,
    });
  } catch (err) {
    console.error("[webhook] verifyFlutterwaveTransaction threw an error for transactionId:", transactionId, "— error:", err);
    // Non-200 so Flutterwave actually retries this webhook later.
    // A 200 here would tell Flutterwave "delivered successfully" and
    // they would never call us again for this event.
    res.status(502).json({ received: true, processed: false, reason: "verification failed" });
    return;
  }

  const amountMatches = Number(verified.amount) === Number(supportRecord.amount);
  const txRefMatches = verified.txRef === txRef;

  console.log("[webhook] Cross-check results:", {
    amountMatches,
    txRefMatches,
    verifiedStatus: verified.status,
    expectedAmount: supportRecord.amount,
    verifiedAmount: verified.amount,
  });

  if (!amountMatches || !txRefMatches || verified.status !== "successful") {
    console.error(
      "[webhook] Cross-check FAILED — marking support as failed. amountMatches:",
      amountMatches,
      "txRefMatches:",
      txRefMatches,
      "verified.status:",
      verified.status
    );

    await pool.query(
      `UPDATE supports SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [supportRecord.id]
    );
    res.status(200).json({ received: true, processed: true, result: "failed" });
    return;
  }

  console.log("[webhook] All checks passed — marking support as successful. support id:", supportRecord.id);

  await pool.query(
    `UPDATE supports SET status = 'successful', flw_ref = $1, updated_at = NOW() WHERE id = $2`,
    [verified.flwRef, supportRecord.id]
  );

  console.log("[webhook] DB updated to successful. Fetching creator info for notification email — creatorId:", supportRecord.creator_id);

  const creatorResult = await pool.query(
    "SELECT email, display_name, username FROM users WHERE id = $1",
    [supportRecord.creator_id]
  );
  const creator = creatorResult.rows[0];

  if (creator) {
    console.log("[webhook] Sending tip notification email to:", creator.email);
    try {
      await sendTipNotificationEmail(
        creator.email,
        creator.display_name || creator.username,
        supportRecord.fan_name,
        Number(supportRecord.amount),
        supportRecord.notes
      );
      console.log("[webhook] Tip notification email sent successfully");
    } catch (err) {
      console.error("[webhook] Failed to send tip notification email:", err);
    }
  } else {
    console.error("[webhook] No creator found for creatorId:", supportRecord.creator_id, "— skipping email");
  }

  console.log("[webhook] Webhook processing complete for support id:", supportRecord.id);
  res.status(200).json({ received: true, processed: true, result: "successful" });
});
// export const handleFlutterwaveWebhook = asyncHandler(async (req: Request, res: Response) => {
//   const signature = req.headers["verif-hash"];

//   if (!signature || signature !== process.env.FLW_WEBHOOK_SECRET_HASH) {
//     // Don't leak details about why — just reject.
//     res.status(401).end();
//     return;
//   }

//   const event = req.body;
//   const transactionId = event?.id;
//   const txRef = event?.txRef;

//   if (!transactionId || !txRef) {
//     // Acknowledge with 200 so Flutterwave doesn't keep retrying a
//     // malformed payload forever, but don't process anything.
//     res.status(200).json({ received: true, processed: false });
//     return;
//   }

//   // Look up our own pending record first — if we don't recognize this
//   // tx_ref at all, there's nothing to do (could be a stale/replayed event).
//   const supportResult = await pool.query(
//     "SELECT id, status, amount, creator_id FROM supports WHERE tx_ref = $1",
//     [txRef]
//   );

//   if ((supportResult.rowCount ?? 0) === 0) {
//     res.status(200).json({ received: true, processed: false });
//     return;
//   }

//   const supportRecord = supportResult.rows[0];

//   // Idempotency guard — already processed, nothing more to do.
//   if (supportRecord.status === "successful" || supportRecord.status === "failed") {
//     res.status(200).json({ received: true, processed: false, reason: "already processed" });
//     return;
//   }

//   let verified;
//   try {
//     verified = await verifyFlutterwaveTransaction(transactionId);
//   } catch (err) {
//     // Flutterwave's API is unreachable/erroring — return 200 so they
//     // retry the webhook later, but don't mark anything as final yet.
//     res.status(200).json({ received: true, processed: false, reason: "verification failed" });
//     return;
//   }

//   // Cross-check the verified data against what we recorded at
//   // initiation time — protects against tampered amounts.
//   const amountMatches = Number(verified.amount) === Number(supportRecord.amount);
//   const txRefMatches = verified.txRef === txRef;

//   if (!amountMatches || !txRefMatches || verified.status !== "successful") {
//     await pool.query(
//       `UPDATE supports SET status = 'failed', updated_at = NOW() WHERE id = $1`,
//       [supportRecord.id]
//     );
//     res.status(200).json({ received: true, processed: true, result: "failed" });
//     return;
//   }

//   await pool.query(
//     `UPDATE supports SET status = 'successful', flw_ref = $1, updated_at = NOW() WHERE id = $2`,
//     [verified.flwRef, supportRecord.id]
//   );

//   // TODO: trigger a notification to the creator here (email/push), and
//   // any other post-payment side effects (e.g. updating a "total raised"
//   // counter on the creator's profile).
//   // Fetch creator's email/name for the notification
//   const creatorResult = await pool.query(
//     "SELECT email, display_name, username FROM users WHERE id = $1",
//     [supportRecord.creator_id]
//   );
//   const creator = creatorResult.rows[0];

//   if (creator) {
//     try {
//       await sendTipNotificationEmail(
//         creator.email,
//         creator.display_name || creator.username,
//         supportRecord.fan_name,
//         Number(supportRecord.amount),
//         supportRecord.notes
//       );
//     } catch (err) {
//       // Don't let a failed email break the webhook response — Flutterwave
//       // will retry the webhook if you don't return 200, and you don't want
//       // an email provider hiccup to cause duplicate processing attempts
//       console.error("Failed to send tip notification email:", err);
//     }
//   }

//   res.status(200).json({ received: true, processed: true, result: "successful" });
// });