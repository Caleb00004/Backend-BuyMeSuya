import { Router } from "express";
import { fetchBanks, resolveBankName, confirmBankDetails } from "../controllers/banksController";

const router = Router();

router.post("/get", fetchBanks);
router.post("/resolvename", resolveBankName);
router.patch("/users/:id/bank/confirm", confirmBankDetails); // ⚠️ add auth middleware


export default router;