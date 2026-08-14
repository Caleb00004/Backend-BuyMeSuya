import { Resend } from "resend"
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY as string);

export async function sendOtpEmail(to: string, code: string) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const fromAddress = process.env.RESEND_FROM_ADDRESS || "Acme <onboarding@resend.dev>";

  const html = `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: [to],
    subject: "BuyMeSuya verification code",
    html,
  });

  if (error) {
    throw new Error(`Failed to send OTP: ${JSON.stringify(error)}`);
  }
}

export default sendOtpEmail;