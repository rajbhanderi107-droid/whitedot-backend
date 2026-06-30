import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.middleware.js";
import { publicLimiter } from "../middleware/rateLimit.middleware.js";
import {
  publicInquirySchema,
  publicQuoteRequestSchema,
  publicSampleRequestSchema,
  calculatorSubmissionSchema,
  publicChatSchema,
} from "../validators/public.validator.js";
import * as pub from "../controllers/public.controller.js";
import * as caseStudy from "../controllers/caseStudy.controller.js";

const router = Router();

router.use(publicLimiter);

router.get("/case-studies", asyncHandler(caseStudy.getPublicCaseStudies));

router.post("/inquiry", validate(publicInquirySchema), asyncHandler(pub.submitInquiry));
router.post("/quote-request", validate(publicQuoteRequestSchema), asyncHandler(pub.submitQuoteRequest));
router.post("/sample-request", validate(publicSampleRequestSchema), asyncHandler(pub.submitSampleRequest));
router.post("/calculator-submission", validate(calculatorSubmissionSchema), asyncHandler(pub.submitCalculatorSubmission));
router.post("/chat", validate(publicChatSchema), asyncHandler(pub.submitChat));

export default router;
