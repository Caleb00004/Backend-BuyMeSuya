const FLW_BASE_URL = "https://api.flutterwave.com/v3";

function flwHeaders() {
  return {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

// -------------------- Subaccount creation --------------------

export interface CreateSubaccountParams {
  accountBank: string; // bank code, e.g. "044"
  accountNumber: string;
  businessName: string; // use the RESOLVED account_name from /accounts/resolve, not user input
  businessMobile: string;
  businessEmail: string;
  country?: string; // defaults to "NG"
  splitType?: "percentage" | "flat";
  splitValue?: number; // e.g. 0.92 for creator's 92% share
}

export interface FlutterwaveSubaccountResult {
  subaccountId: string; // this is what you store as subaccount_code
  accountNumber: string;
  bankCode: string;
  raw: any;
}

/**
 * Creates a Flutterwave subaccount for a creator so future payments
 * can be split directly to their bank account.
 * Throws on failure — caller decides how to respond to the client.
 */
export async function createFlutterwaveSubaccount(
  params: CreateSubaccountParams
): Promise<FlutterwaveSubaccountResult> {
  const {
    accountBank,
    accountNumber,
    businessName,
    businessEmail,
    businessMobile,
    country = "NG",
    splitType = "percentage",
    splitValue = 0.08, //  platform keeps 8%, creator gets 92%
  } = params;

  const response = await fetch(`${FLW_BASE_URL}/subaccounts`, {
    method: "POST",
    headers: flwHeaders(),
    body: JSON.stringify({
      account_bank: accountBank,
      account_number: accountNumber,
      business_name: businessName,
      business_mobile: businessMobile,
      business_email: businessEmail,
      country,
      split_type: splitType,
      split_value: splitValue,
    }),
  });

  const json = await response.json();

  if (!response.ok || json.status !== "success") {
      // Recoverable case: a subaccount for this exact bank+account already
      // exists on Flutterwave (likely from a previous attempt that failed
      // to save on our side). Look it up instead of failing outright.
      // if (json.message?.toLowerCase().includes("already exists")) {
      //   const existing = await findExistingSubaccount(params.accountBank, params.accountNumber);
      //     if (existing) {
      //       return existing;
      //     }
      // }
    throw new Error(json.message ?? "Failed to create Flutterwave subaccount");
  }

  return {
    subaccountId: json.data.subaccount_id,
    accountNumber: json.data.account_number,
    bankCode: json.data.account_bank,
    raw: json.data,
  };
}

export async function updateFlutterwaveSubaccount(
  subaccountId: string,
  params: Omit<CreateSubaccountParams, "splitType" | "splitValue">
): Promise<FlutterwaveSubaccountResult> {
  const { accountBank, accountNumber, businessName, businessEmail, businessMobile, country = "NG" } = params;

  const response = await fetch(`${FLW_BASE_URL}/subaccounts/${subaccountId}`, {
    method: "PUT",
    headers: flwHeaders(),
    body: JSON.stringify({
      account_bank: accountBank,
      account_number: accountNumber,
      business_name: businessName,
      business_mobile: businessMobile,
      business_email: businessEmail,
      country,
    }),
  });

  const json = await response.json();

  if (!response.ok || json.status !== "success") {
    throw new Error(json.message ?? "Failed to update Flutterwave subaccount");
  }

  return {
    subaccountId: json.data.id ?? json.data.subaccount_id,
    accountNumber: json.data.account_number,
    bankCode: json.data.account_bank,
    raw: json.data,
  };
}

// -------------------- Payment initiation --------------------

export interface InitiatePaymentParams {
  txRef: string;
  amount: number;
  currency?: string; // defaults to "NGN"
  redirectUrl: string;
  customerEmail: string;
  customerName?: string;
  customerPhone?: string;
  subaccountId: string; // creator's subaccount_code
  narration?: string;
}

export interface FlutterwaveInitiateResult {
  paymentLink: string;
  raw: any;
}

/**
 * Initiates a Flutterwave standard checkout payment (supports card,
 * bank transfer, USSD, etc. depending on payment_options) with the
 * transaction split to the given creator subaccount.
 * Throws on failure.
 */
export async function initiateFlutterwavePayment(
  params: InitiatePaymentParams
): Promise<FlutterwaveInitiateResult> {
  const {
    txRef,
    amount,
    currency = "NGN",
    redirectUrl,
    customerEmail,
    customerName,
    customerPhone,
    subaccountId,
    narration,
  } = params;

  const response = await fetch(`${FLW_BASE_URL}/payments`, {
    method: "POST",
    headers: flwHeaders(),
    body: JSON.stringify({
      tx_ref: txRef,
      amount,
      currency,
      redirect_url: redirectUrl,
      payment_options: "card,banktransfer,ussd",
      customer: {
        email: customerEmail,
        name: customerName,
        phonenumber: customerPhone,
      },
      customizations: {
        title: narration ?? "Support a creator",
      },
      subaccounts: [{ id: subaccountId }],
    }),
  });

  const json = await response.json();

  if (!response.ok || json.status !== "success") {
    throw new Error(json.message ?? "Failed to initiate payment");
  }

  return {
    paymentLink: json.data.link,
    raw: json.data,
  };
}

// -------------------- Transaction verification --------------------

export interface VerifyTransactionResult {
  status: "successful" | "failed" | "pending" | string;
  amount: number;
  currency: string;
  txRef: string;
  flwRef: string;
  raw: any;
}

/**
 * Re-verifies a transaction directly with Flutterwave, by transaction id.
 * ALWAYS call this from the webhook handler before trusting a payment —
 * never trust the webhook payload's amount/status on its own.
 */
export async function verifyFlutterwaveTransaction(
  transactionId: string | number
): Promise<VerifyTransactionResult> {
  const response = await fetch(
    `${FLW_BASE_URL}/transactions/${transactionId}/verify`,
    {
      method: "GET",
      headers: flwHeaders(),
    }
  );

  const json = await response.json();

  if (!response.ok || json.status !== "success") {
    throw new Error(json.message ?? "Failed to verify transaction");
  }

  return {
    status: json.data.status,
    amount: json.data.amount,
    currency: json.data.currency,
    txRef: json.data.tx_ref,
    flwRef: json.data.flw_ref,
    raw: json.data,
  };
}


async function findExistingSubaccount(
  accountBank: string,
  accountNumber: string
): Promise<FlutterwaveSubaccountResult | null> {
  const response = await fetch(`${FLW_BASE_URL}/subaccounts`, {
    method: "GET",
    headers: flwHeaders(),
  });

  const json = await response.json();
  if (!response.ok || json.status !== "success") return null;

  const match = json.data.find(
    (sub: any) => sub.account_bank === accountBank && sub.account_number === accountNumber
  );

  if (!match) return null;

  return {
    subaccountId: match.id ?? match.subaccount_id,
    accountNumber: match.account_number,
    bankCode: match.account_bank,
    raw: match,
  };
}