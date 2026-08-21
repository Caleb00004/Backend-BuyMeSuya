import { Resend } from "resend"
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY as string);

// utils/send_email.ts

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

// ---- Core sender — the ONE place that talks to Resend ----

async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const fromAddress = process.env.RESEND_FROM_ADDRESS || "BuyMeSuya <onboarding@resend.dev>";

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [to],
    subject,
    html,
  });

  if (error) {
    throw new Error(`Failed to send email ("${subject}"): ${JSON.stringify(error)}`);
  }
}

// ---- Email templates — each one just builds subject + html, then delegates ----

async function sendOtpEmail(to: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: "BuyMeSuya verification code",
    html: `
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>This code expires in 10 minutes.</p>
    `,
  });
}

async function sendTipNotificationEmail(
  creatorEmail: string,
  creatorName: string,
  fanName: string | null,
  amount: number,
  note: string | null
): Promise<void> {
  await sendEmail({
    to: creatorEmail,
    subject: `You just got tipped ₦${amount.toLocaleString()}! 🎉`,
    html: `
      <p>Hey ${creatorName},</p>
      <p><strong>${fanName || "Someone"}</strong> just sent you ₦${amount.toLocaleString()}!</p>
      ${note ? `<p>They said: "${note}"</p>` : ""}
      <p>Check your dashboard to see all your supporters.</p>
    `,
  });
}

async function sendBankDetailsUpdatedEmail(
  to: string,
  creatorName: string,
  newAccountName: string,
  bankCode: string
): Promise<void> {
  await sendEmail({
    to,
    subject: "Your BuyMeSuya payout details were updated",
    html: `
      <p>Hey ${creatorName},</p>
      <p>Your payout bank account was just updated to an account under the name <strong>${newAccountName}</strong>.</p>
      <p>If you made this change, no action is needed.</p>
      <p>If you did <strong>not</strong> make this change, please contact us immediately at buymesuya@gmail.com — your account may be compromised.</p>
    `,
  });
}

async function sendPasswordResetEmail(
  to: string,
  username: string,
  resetLink: string
): Promise<void> {
  await sendEmail({
    to,
    subject: "Reset your BuyMeSuya password",
    html: `
      <p>Hey ${username},</p>
      <p>We received a request to reset your password. Click the link below to set a new one:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

export {sendOtpEmail, sendTipNotificationEmail, sendPasswordResetEmail, sendBankDetailsUpdatedEmail};