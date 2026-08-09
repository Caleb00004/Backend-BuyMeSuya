import { Router } from "express";
import { fetchBanks, resolveBankName } from "../controllers/banksController";

const router = Router();

router.post("/get", fetchBanks);
router.post("/resolvename", resolveBankName);

export default router;