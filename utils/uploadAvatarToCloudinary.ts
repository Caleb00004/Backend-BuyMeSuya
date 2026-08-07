import { v2 as cloudinary } from "cloudinary";

// @ts-ignore
export async function uploadAvatarToCloudinary(file: Express.Multer.File, userId: string): Promise<string> {
    const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(base64, {
        public_id: `chain-play/avatars/${userId}`,
        overwrite: true,
        crop: "fill",
        gravity: "auto", 
        width: 400,
        height: 400,
        fetch_format: "auto",
        quality: "auto",
    });
    return result.secure_url;
}