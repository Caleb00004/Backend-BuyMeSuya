// ---- Adjust these import paths to match your project structure ----
// import { app } from "../../app"; // your Express app (not app.listen(), just the app instance)

import { uploadAvatarToCloudinary } from "../../utils/uploadAvatarToCloudinary";
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { pool } from "../../config/db";
import { hashPassword, } from "../../utils/password";
import { verifyOtp } from "./../../controllers/otpController";

vi.mock("../../config/db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../../utils/password", () => ({
  hashPassword: vi.fn(),
}));

vi.mock("../../controllers/otpController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../controllers/otpController")>();
  return {
    ...actual,
    verifyOtp: vi.fn(),
  };
});

// Simple fake auth: requires "Authorization: Bearer <userId>",
// attaches req.user = { id }. Swap this for whatever your real
// auth middleware actually does.
vi.mock("../../middlewares/auth", () => ({
  auth: (req: any, res: any, next: any) => {
    const token = req.cookies?.accessToken;
    if (!token) {
      res.sendStatus(401);
      return;
    }
    // token itself carries the fake payload — see helper below
    req.user = JSON.parse(Buffer.from(token, "base64").toString());
    next();
  },
}));

function fakeAuthCookie(payload: Record<string, any>) {
  const token = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `accessToken=${token}`;
}

const mockedQuery = vi.mocked(pool.query);
const mockedHash = vi.mocked(hashPassword);
const mockedVerifyOtp = vi.mocked(verifyOtp);

function makeUserRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    username: "testuser",
    email: "test@example.com",
    display_name: null,
    bio: null,
    avatar_url: null,
    bank_name: null,
    bank_account_number: null,
    bank_account_name: null,
    subaccount_code: null,
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedHash.mockReset();
  mockedVerifyOtp.mockReset();
});

describe("POST / (createUser)", () => {
  const validBody = {
    username: "testuser",
    email: "test@example.com",
    password: "password123",
    otp: "123456",
  };

  it("creates a user with a valid OTP", async () => {
    mockedVerifyOtp.mockResolvedValue(true);
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any); // dup check
    mockedHash.mockReturnValue("salt:hashedvalue");
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [makeUserRow()] } as any); // insert

    const res = await request(app).post("/api/users").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("testuser");
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it.each([
    ["username", { ...validBody, username: undefined }, /username/i],
    ["email", { ...validBody, email: "not-an-email" }, /email/i],
    ["password", { ...validBody, password: "short" }, /password/i],
    ["otp", { ...validBody, otp: undefined }, /otp/i],
  ])("rejects when %s is invalid/missing", async (_field, body, messageMatch) => {
    const res = await request(app).post("/api/users").send(body);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(messageMatch);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired OTP", async () => {
    mockedVerifyOtp.mockResolvedValue(false);

    const res = await request(app).post("/api/users").send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/otp/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects a duplicate username/email with 409", async () => {
    mockedVerifyOtp.mockResolvedValue(true);
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] } as any);

    const res = await request(app).post("/api/users").send(validBody);

    expect(res.status).toBe(409);
  });
});

describe("POST /check-username", () => {
  it("returns available: true when username is free", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app).post("/api/users/check-username").send({ username: "freename" });

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it("returns available: false when username is taken", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] } as any);

    const res = await request(app).post("/api/users/check-username").send({ username: "taken" });

    expect(res.body.available).toBe(false);
  });

  it("rejects a missing username", async () => {
    const res = await request(app).post("/api/users/check-username").send({});
    expect(res.status).toBe(400);
  });
});

describe("PUT /:id/profile (updateUserProfile)", () => {
  it("rejects when no auth cookie is provided", async () => {
    const res = await request(app).put("/users/1/profile").send({ display_name: "New" });
    expect(res.status).toBe(401);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("updates display_name and bio when authenticated", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ display_name: "New Name", bio: "New bio" })],
    } as any);

    const res = await request(app)
      .put("/users/1/profile")
      .set("Cookie", fakeAuthCookie({ id: 1 }))
      .send({ display_name: "New Name", bio: "New bio" });

    expect(res.status).toBe(200);
    expect(res.body.user.display_name).toBe("New Name");
  });

  it("rejects an invalid user id", async () => {
    const res = await request(app)
      .put("/users/not-a-number/profile")
      .set("Cookie", fakeAuthCookie({ id: 1 }))
      .send({ display_name: "New" });

    expect(res.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const res = await request(app)
      .put("/users/1/profile")
      .set("Cookie", fakeAuthCookie({ id: 1 }))
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when the user doesn't exist", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app)
      .put("/users/99999/profile")
      .set("Cookie", fakeAuthCookie({ id: 99999 }))
      .send({ display_name: "New" });

    expect(res.status).toBe(404);
  });
});

describe("PUT /:id/avatar (updateUserAvatar)", () => {
  it("rejects when no auth token is provided", async () => {
    const res = await request(app)
      .put("/users/1/avatar")
      .send({ avatar_url: "https://cdn.example.com/a.png" });

    expect(res.status).toBe(401);
  });

  it("updates avatar_url when authenticated", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ avatar_url: "https://cdn.example.com/new.png" })],
    } as any);

    const res = await request(app)
      .put("/users/1/avatar")
      .set("Cookie", fakeAuthCookie({ id: 1 }))
      .send({ avatar_url: "https://cdn.example.com/new.png" });

    expect(res.status).toBe(200);
    expect(res.body.user.avatar_url).toBe("https://cdn.example.com/new.png");
  });

  it("rejects a missing avatar_url", async () => {
    const res = await request(app)
      .put("/users/1/avatar")
      .set("Cookie", fakeAuthCookie({ id: 1 }))
      .send({});

    expect(res.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-existent user", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app)
      .put("/users/99999/avatar")
      .set("Authorization", "Bearer 99999")
      .send({ avatar_url: "https://cdn.example.com/new.png" });

    expect(res.status).toBe(404);
  });
});