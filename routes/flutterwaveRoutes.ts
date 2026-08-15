import { Router } from "express";
import {
  fetchBanks,
  resolveBankName,
  confirmBankDetails,
  initiateSupport,
  handleFlutterwaveWebhook,
} from "../controllers/flutterwaveController";
import { auth } from "../middlewares/auth";

const router = Router();

router.get("/banks/get", fetchBanks);
router.post("/banks/resolvename", resolveBankName);
router.patch("/users/:id/bank/confirm", auth, confirmBankDetails);
router.post("/support/initiate", initiateSupport);
router.post("/webhooks", handleFlutterwaveWebhook);

export default router;
