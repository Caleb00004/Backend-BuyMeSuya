import { Router } from "express";
import {
  fetchBanks,
  resolveBankName,
  confirmBankDetails,
  initiateSupport,
  handleFlutterwaveWebhook,
} from "../controllers/flutterwaveController";

const router = Router();

router.get("/banks/get", fetchBanks);
router.post("/banks/resolvename", resolveBankName);
router.patch("/users/:id/bank/confirm", confirmBankDetails);
router.post("/support/initiate", initiateSupport);
router.post("/webhooks", handleFlutterwaveWebhook);

export default router;
