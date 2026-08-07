import { Router } from "express";
import {
  createUser,
  updateUserProfile,
  updateUserBankDetails,
  updateUserAvatar,
} from "../controllers/userController";
import { auth } from "../middlewares/auth";

const userRoutes = Router();

userRoutes.post("/", createUser);
userRoutes.put("/:id/profile", auth, updateUserProfile);
userRoutes.put("/:id/bank", auth, updateUserBankDetails);
userRoutes.put("/:id/avatar", auth, updateUserAvatar);

export default userRoutes;
