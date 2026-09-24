import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as tb from "../controllers/trialBook.controller.js";
import {
  createTrialSchema,
  updateTrialSchema,
  markSyncedSchema,
  folderHighestSchema,
} from "../validators/trialBook.validator.js";

const router = Router();

// Same access as the Route Book: any signed-in portal user.
router.use(requireAuth);

router.get("/", asyncHandler(tb.list));
router.get("/next-number", asyncHandler(tb.nextNumber));

// The laptop reports the highest trial number the folder has used, so the
// portal never hands that number out again.
router.post("/folder-highest", validate(folderHighestSchema), asyncHandler(tb.folderHighest));
router.get("/:id", asyncHandler(tb.getOne));

router.post("/", validate(createTrialSchema), asyncHandler(tb.create));
router.patch("/:id", validate(updateTrialSchema), asyncHandler(tb.update));
router.delete("/:id", asyncHandler(tb.remove));

// The laptop reports back which workbook it wrote for this trial.
router.post("/:id/synced", validate(markSyncedSchema), asyncHandler(tb.markSynced));

export default router;
