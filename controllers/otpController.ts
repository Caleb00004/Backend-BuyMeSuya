import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { randomBytes, scryptSync } from "crypto";
import { pool } from "../config/db";
import { sendOtpEmail } from "../utils/send_email";
// import sendOtpEmail from "../utils/send_email";

const hash = (value: string, salt: string) => scryptSync(value, salt, 64).toString("hex");

// const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const generateCode = () => Math.floor(10000 + Math.random() * 90000).toString();

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    
    if (!email) {
        res.status(400).json({ success: false, message: "Email is required" })
        return     
    }

    const code = generateCode();
    const salt = randomBytes(16).toString("hex");
    const codeHash = hash(code, salt);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Upsert: insert or update the existing OTP row for this email
        await pool.query(
            `INSERT INTO email_otps (email, code_hash, salt, expires_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO UPDATE SET
                 code_hash = EXCLUDED.code_hash,
                 salt = EXCLUDED.salt,
                 expires_at = EXCLUDED.expires_at,
                 created_at = NOW()`,
            [email, codeHash, salt, expiresAt]
        );

    // Send email (may throw)
    await sendOtpEmail(email, code);

    res.json({ success: true, message: "OTP sent" });
});

export const verifyOtp = async (email: string, code: string): Promise<boolean> => {
    const result = await pool.query("SELECT id, code_hash, salt, expires_at FROM email_otps WHERE email = $1", [email]);
    if ((result.rowCount ?? 0) === 0) return false;

    const row = result.rows[0];
    if (new Date(row.expires_at) < new Date()) return false;

    const candidate = hash(code, row.salt);
    if (candidate !== row.code_hash) return false;

    // delete used OTP
    await pool.query("DELETE FROM email_otps WHERE id = $1", [row.id]);
    return true;
};

export default sendOtp;
