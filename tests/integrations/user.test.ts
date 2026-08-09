import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// ---- Adjust these import paths to match your project structure ----
// import { app } from "../../app"; // your Express app (not app.listen(), just the app instance)
import { app } from "../../app";
import { pool } from "../../config/db";
import { uploadAvatarToCloudinary } from "../../utils/uploadAvatarToCloudinary";
import { hashPassword } from "../../utils/password";
// ---------------------------------------------------------------------

vi.mock("../../config/db", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../../utils/uploadAvatarToCloudinary", () => ({
  uploadAvatarToCloudinary: vi.fn(),
}));

vi.mock("../../utils/password", () => ({
  hashPassword: vi.fn(),
}));

const mockedQuery = vi.mocked(pool.query);
const mockedUpload = vi.mocked(uploadAvatarToCloudinary);
const mockedHash = vi.mocked(hashPassword);

function makeUserRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    username: "testuser",
    email: "test@example.com",
    display_name: "Test User",
    bio: null,
    avatar_url: "https://cloudinary.com/fake.png",
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
  mockedUpload.mockReset();
  mockedHash.mockReset();
});

describe("POST /users (createUser)", () => {
  it("creates a user successfully with an avatar file", async () => {
    // 1st query: existing user check -> none found
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
    mockedHash.mockReturnValue("salt:hashedvalue");
    mockedUpload.mockResolvedValue("https://cloudinary.com/uploaded.png");
    // 2nd query: insert -> returns created row
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ avatar_url: "https://cloudinary.com/uploaded.png" })],
    } as any);

    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "Test@Example.com") // testing normalization (lowercased)
      .field("password", "password123")
      .field("display_name", "Test User")
      .attach("avatar", Buffer.from("fake-image-bytes"), {
        filename: "avatar.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe("testuser");
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: "avatar.png" }),
      "testuser"
    );
    // confirm email was normalized/lowercased before hitting the DB check
    expect(mockedQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT id FROM users"),
      ["testuser", "test@example.com"]
    );
  });

  it("rejects when username is missing", async () => {
    const res = await request(app)
      .post("/users")
      .field("email", "test@example.com")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/username/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects when username is only whitespace", async () => {
    const res = await request(app)
      .post("/users")
      .field("username", "   ")
      .field("email", "test@example.com")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/username/i);
  });

  it("rejects an invalid email (no @)", async () => {
    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "not-an-email")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing email", async () => {
    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email/i);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "test@example.com")
      .field("password", "short")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing password", async () => {
    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "test@example.com")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
  });

  it("rejects duplicate username or email with 409", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] } as any);

    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "test@example.com")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("rejects when no avatar file is provided", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "test@example.com")
      .field("password", "password123");
    // no .attach()

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/image/i);
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("returns 500 (not a raw stack trace) if Cloudinary upload fails", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
    mockedUpload.mockRejectedValue(new Error("Cloudinary is down"));

    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "test@example.com")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.status).toBe(500);
    // Make sure internals aren't leaked to the client
    expect(JSON.stringify(res.body)).not.toMatch(/Cloudinary is down/);
  });

  it("never returns the plaintext password or password_hash in the response", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
    mockedHash.mockReturnValue("salt:hashedvalue");
    mockedUpload.mockResolvedValue("https://cloudinary.com/uploaded.png");
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow()],
    } as any);

    const res = await request(app)
      .post("/users")
      .field("username", "testuser")
      .field("email", "test@example.com")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it("rejects a SQL-injection-style payload in username/email without erroring", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
    mockedHash.mockReturnValue("salt:hashedvalue");
    mockedUpload.mockResolvedValue("https://cloudinary.com/uploaded.png");
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ username: "robert'); drop table users;--" })],
    } as any);

    const res = await request(app)
      .post("/users")
      .field("username", "robert'); drop table users;--")
      .field("email", "test@example.com")
      .field("password", "password123")
      .attach("avatar", Buffer.from("fake"), "avatar.png");

    // Should be treated as an ordinary (if odd) string, not error out —
    // proves it's passed as a parameter, not concatenated into SQL.
    expect(res.status).toBe(201);
    expect(mockedQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SELECT id FROM users"),
      ["robert'); drop table users;--", "test@example.com"]
    );
  });
});

describe("PATCH /users/:id (updateUserProfile)", () => {
  it("updates display_name and bio successfully", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ display_name: "New Name", bio: "New bio" })],
    } as any);

    const res = await request(app)
      .patch("/users/1")
      .send({ display_name: "New Name", bio: "New bio" });

    expect(res.status).toBe(200);
    expect(res.body.user.display_name).toBe("New Name");
  });

  it("rejects an invalid (non-numeric) user id", async () => {
    const res = await request(app)
      .patch("/users/not-a-number")
      .send({ display_name: "New Name" });

    expect(res.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects a negative or zero user id", async () => {
    const res = await request(app)
      .patch("/users/0")
      .send({ display_name: "New Name" });

    expect(res.status).toBe(400);
  });

  it("rejects an empty body with no fields to update", async () => {
    const res = await request(app).patch("/users/1").send({});

    expect(res.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the user doesn't exist", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app)
      .patch("/users/99999")
      .send({ display_name: "New Name" });

    expect(res.status).toBe(404);
  });

  it("allows updating only bio without display_name", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ bio: "Only bio changed" })],
    } as any);

    const res = await request(app).patch("/users/1").send({ bio: "Only bio changed" });

    expect(res.status).toBe(200);
    expect(mockedQuery.mock.calls[0][0]).toContain("bio = $1");
    expect(mockedQuery.mock.calls[0][0]).not.toContain("display_name");
  });

  // ⚠️ Documents a real vulnerability — no ownership/auth check.
  // This currently passes, which is the problem. Once you add auth
  // (e.g. requiring req.user.id === userId, or an admin role), flip
  // this test to expect 401/403 instead of 200.
  it("[SECURITY GAP] currently allows updating ANY user's profile with no authentication", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ id: 42, display_name: "Hijacked Name" })],
    } as any);

    const res = await request(app)
      .patch("/users/42") // arbitrary user id, no auth header sent
      .send({ display_name: "Hijacked Name" });

    expect(res.status).toBe(200); // TODO: should be 401/403 once auth is added
  });
});

describe("PATCH /users/:id/bank (updateUserBankDetails)", () => {
  it("updates bank details successfully", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        makeUserRow({
          bank_name: "Test Bank",
          bank_account_number: "0123456789",
          bank_account_name: "Test User",
        }),
      ],
    } as any);

    const res = await request(app).patch("/users/1/bank").send({
      bank_name: "Test Bank",
      bank_account_number: "0123456789",
      bank_account_name: "Test User",
    });

    expect(res.status).toBe(200);
    expect(res.body.user.bank_name).toBe("Test Bank");
  });

  it("rejects an invalid user id", async () => {
    const res = await request(app)
      .patch("/users/abc/bank")
      .send({ bank_name: "Test Bank" });

    expect(res.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const res = await request(app).patch("/users/1/bank").send({});

    expect(res.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-existent user", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app)
      .patch("/users/99999/bank")
      .send({ subaccount_code: "ACCT_123" });

    expect(res.status).toBe(404);
  });

  it("allows partial updates (subaccount_code only)", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ subaccount_code: "ACCT_999" })],
    } as any);

    const res = await request(app)
      .patch("/users/1/bank")
      .send({ subaccount_code: "ACCT_999" });

    expect(res.status).toBe(200);
    expect(mockedQuery.mock.calls[0][0]).toContain("subaccount_code = $1");
  });

  // ⚠️ This is the highest-severity gap: bank details, unauthenticated.
  it("[SECURITY GAP] currently allows changing ANY user's bank account with no authentication", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ id: 7, bank_account_number: "9999999999" })],
    } as any);

    const res = await request(app)
      .patch("/users/7/bank")
      .send({ bank_account_number: "9999999999" }); // attacker-controlled payout account

    expect(res.status).toBe(200); // TODO: must become 401/403 once auth is added
  });
});

describe("PATCH /users/:id/avatar (updateUserAvatar)", () => {
  it("updates avatar_url successfully", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ avatar_url: "https://cloudinary.com/new.png" })],
    } as any);

    const res = await request(app)
      .patch("/users/1/avatar")
      .send({ avatar_url: "https://cloudinary.com/new.png" });

    expect(res.status).toBe(200);
    expect(res.body.user.avatar_url).toBe("https://cloudinary.com/new.png");
  });

  it("rejects a missing avatar_url", async () => {
    const res = await request(app).patch("/users/1/avatar").send({});

    expect(res.status).toBe(400);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid user id", async () => {
    const res = await request(app)
      .patch("/users/xyz/avatar")
      .send({ avatar_url: "https://cloudinary.com/new.png" });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent user", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);

    const res = await request(app)
      .patch("/users/99999/avatar")
      .send({ avatar_url: "https://cloudinary.com/new.png" });

    expect(res.status).toBe(404);
  });

  // ⚠️ This endpoint accepts an arbitrary client-supplied URL, bypassing
  // Cloudinary entirely — nothing validates it's actually an image, or
  // even a URL from a trusted host. Worth deciding if that's intended.
  it("[REVIEW] accepts an arbitrary non-image URL as avatar_url with no validation", async () => {
    mockedQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [makeUserRow({ avatar_url: "javascript:alert(1)" })],
    } as any);

    const res = await request(app)
      .patch("/users/1/avatar")
      .send({ avatar_url: "javascript:alert(1)" });

    expect(res.status).toBe(200); // TODO: should probably validate URL format/scheme
  });
});