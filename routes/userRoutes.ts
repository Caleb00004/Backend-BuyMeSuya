import { Router } from "express";
import {
  createUser,
  updateUserProfile,
  updateUserAvatar,
  checkUsername,
  getUserProfile,
  getMyProfile,
} from "../controllers/userController";
import { auth } from "../middlewares/auth";

const userRoutes = Router();

userRoutes.post("/", createUser);
userRoutes.get("/me", auth, getMyProfile);
userRoutes.get("/check-username/:username", checkUsername);
userRoutes.get("/:username", getUserProfile);
userRoutes.put("/:id/profile", auth, updateUserProfile);
userRoutes.put("/:id/avatar", auth, updateUserAvatar);

export default userRoutes;
