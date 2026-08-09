import { Router } from "express";
import {
  createUser,
  updateUserProfile,
  updateUserAvatar,
  checkUsername,
} from "../controllers/userController";
import { auth } from "../middlewares/auth";

const userRoutes = Router();

userRoutes.post("/", createUser);
userRoutes.post("/check-username", checkUsername);
userRoutes.put("/:id/profile", auth, updateUserProfile);
userRoutes.put("/:id/avatar", auth, updateUserAvatar);

export default userRoutes;
