import { describe, it, expect, beforeEach, vi } from "vitest";
import { uploadAvatarToCloudinary } from "../../utils/uploadAvatarToCloudinary";
import { v2 as cloudinary } from "cloudinary";

vi.mock("cloudinary", () => ({
  v2: {
    uploader: {
      upload: vi.fn(),
    },
  },
}));

const mockedUpload = vi.mocked(cloudinary.uploader.upload);

function makeFakeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "avatar",
    originalname: "avatar.png",
    encoding: "7bit",
    mimetype: "image/png",
    buffer: Buffer.from("fake-image-bytes"),
    size: 17,
    ...overrides,
  } as Express.Multer.File;
}

describe("uploadAvatarToCloudinary", () => {
  beforeEach(() => {
    mockedUpload.mockReset();
  });

  it("uploads with correct base64 data URI and options", async () => {
    mockedUpload.mockResolvedValue({ secure_url: "https://cloudinary.com/fake.png" } as any);

    const file = makeFakeFile();
    const url = await uploadAvatarToCloudinary(file, "user-123");

    expect(mockedUpload).toHaveBeenCalledTimes(1);

    const [dataUri, options] = mockedUpload.mock.calls[0];

    expect(dataUri).toBe(
      `data:image/png;base64,${file.buffer.toString("base64")}`
    );
    expect(options).toMatchObject({
      public_id: "chain-play/avatars/user-123",
      overwrite: true,
      crop: "fill",
      gravity: "auto",
      width: 400,
      height: 400,
      fetch_format: "auto",
      quality: "auto",
    });

    expect(url).toBe("https://cloudinary.com/fake.png");
  });

  it("uses the correct mimetype in the data URI for different file types", async () => {
    mockedUpload.mockResolvedValue({ secure_url: "https://cloudinary.com/fake.jpg" } as any);

    const file = makeFakeFile({ mimetype: "image/jpeg" });
    await uploadAvatarToCloudinary(file, "user-456");

    const [dataUri] = mockedUpload.mock.calls[0];
    expect((dataUri as string).startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("scopes public_id to the given userId, preventing overwrite collisions between users", async () => {
    mockedUpload.mockResolvedValue({ secure_url: "https://cloudinary.com/fake.png" } as any);

    await uploadAvatarToCloudinary(makeFakeFile(), "user-A");
    await uploadAvatarToCloudinary(makeFakeFile(), "user-B");

    expect(mockedUpload.mock.calls[0][1]).toMatchObject({
      public_id: "chain-play/avatars/user-A",
    });
    expect(mockedUpload.mock.calls[1][1]).toMatchObject({
      public_id: "chain-play/avatars/user-B",
    });
  });

  it("propagates errors when Cloudinary upload fails", async () => {
    mockedUpload.mockRejectedValue(new Error("Cloudinary is down"));

    await expect(
      uploadAvatarToCloudinary(makeFakeFile(), "user-789")
    ).rejects.toThrow("Cloudinary is down");
  });

  it("returns the secure_url string, not the full result object", async () => {
    mockedUpload.mockResolvedValue({
      secure_url: "https://cloudinary.com/only-this.png",
      public_id: "irrelevant",
      version: 12345,
    } as any);

    const result = await uploadAvatarToCloudinary(makeFakeFile(), "user-999");
    expect(result).toBe("https://cloudinary.com/only-this.png");
    expect(typeof result).toBe("string");
  });
});