import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as tb from "../controllers/trialBook.controller.js";
import {
  createTrialSchema,
  updateTrialSchema,
  markSyncedSchema,
} from "../validators/trialBook.validator.js";

const router = Router();

// Same access as the Route Book: any signed-in portal user.
router.use(requireAuth);

router.get("/", asyncHandler(tb.list));
router.get("/next-number", asyncHandler(tb.nextNumber));
router.get("/:id", asyncHandler(tb.getOne));

router.post("/", validate(createTrialSchema), asyncHandler(tb.create));
router.patch("/:id", validate(updateTrialSchema), asyncHandler(tb.update));
router.delete("/:id", asyncHandler(tb.remove));

// The laptop reports back which workbook it wrote for this trial.
router.post("/:id/synced", validate(markSyncedSchema), asyncHandler(tb.markSynced));

export default router;
