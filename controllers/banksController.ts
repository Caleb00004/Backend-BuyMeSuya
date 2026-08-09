import asyncHandler from "express-async-handler";
import { Request, Response } from "express";
import {createFlutterwaveSubaccount } from "../services/flutterwave"
import { pool } from "../config/db";

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
 
  const { bank_code, account_number, business_mobile } = req.body as {
    bank_code?: string;
    account_number?: string;
    business_mobile?: string;
  };
 
  if (!bank_code || !account_number || !business_mobile) {
    res.status(400).json({
      success: false,
      message: "bank_code, account_number, and business_mobile are required.",
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
 
  const verifiedAccountName: string = resolveJson.data.account_name;
 
  let subaccount;
  try {
    subaccount = await createFlutterwaveSubaccount({
      accountBank: bank_code,
      accountNumber: account_number,
      businessName: verifiedAccountName,
      businessMobile: business_mobile,
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      message: "Failed to set up payout account with Flutterwave.",
    });
    return;
  }
 
  const result = await pool.query(
    `UPDATE users SET
      bank_name = $1,
      bank_account_number = $2,
      bank_account_name = $3,
      subaccount_code = $4,
      updated_at = NOW()
    WHERE id = $5
    RETURNING id, username, email, display_name, bio, avatar_url,
      bank_name, bank_account_number, bank_account_name, subaccount_code,
      is_verified, created_at, updated_at`,
    [bank_code, account_number, verifiedAccountName, subaccount.subaccountId, userId]
  );
 
  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }
 
  res.status(200).json({ success: true, user: result.rows[0] });
});