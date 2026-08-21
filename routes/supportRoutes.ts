import { Router } from "express";
import { auth } from "../middlewares/auth";
import { getMySupports, getSupportStatus, getUserSupporters } from "../controllers/supportController";

const supportRoutes = Router();

supportRoutes.get("/me", auth, getMySupports);
supportRoutes.get("/status/:txRef", getSupportStatus);
supportRoutes.get("/:username", getUserSupporters);

export default supportRoutes