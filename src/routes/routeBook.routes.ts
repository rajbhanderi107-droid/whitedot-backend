import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.middleware.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import * as rb from "../controllers/routeBook.controller.js";
import {
  patchMarkSchema, bulkMarksSchema, patchLegMarkSchema,
  createStopSchema, bulkStopsSchema, updateStopSchema,
  createViewSchema, putPrefsSchema,
  createSampleSchema,
  updateSampleSchema,
  putSettingsSchema,
  createOrderSchema,
  updateOrderSchema,
  importSchema,
} from "../validators/routeBook.validator.js";

const router = Router();

// Every route-book call needs a signed-in portal user; the book is shared by
// all of them (same access as Inquiries / CRM).
router.use(requireAuth);

// ─── Read ────────────────────────────────────────
router.get("/bootstrap", asyncHandler(rb.bootstrap));
router.get("/summary", asyncHandler(rb.summary));
router.get("/changes", asyncHandler(rb.changes));
router.get("/events", asyncHandler(rb.listEvents));
router.get("/days", asyncHandler(rb.listDays));

// ─── Marks (what happened at a stop) ─────────────
router.patch("/marks/:stopId", validate(patchMarkSchema), asyncHandler(rb.patchMark));
router.post("/marks/bulk", validate(bulkMarksSchema), asyncHandler(rb.bulkMarks));
router.patch("/legs/:legId/mark", validate(patchLegMarkSchema), asyncHandler(rb.patchLegMark));

// ─── Companies added on the road ─────────────────
router.post("/stops", validate(createStopSchema), asyncHandler(rb.createStop));
router.post("/stops/bulk", validate(bulkStopsSchema), asyncHandler(rb.bulkStops));
router.patch("/stops/:id", validate(updateStopSchema), asyncHandler(rb.updateStop));
router.delete("/stops/:id", asyncHandler(rb.deleteStop));
router.post("/stops/:id/restore", asyncHandler(rb.restoreStop));

// ─── Saved views & per-user preferences ──────────
router.get("/views", asyncHandler(rb.listViews));
router.post("/views", validate(createViewSchema), asyncHandler(rb.createView));
router.delete("/views/:id", asyncHandler(rb.deleteView));
// ─── Samples & commercial settings ───────────────
router.get("/samples/open", asyncHandler(rb.openSamples));
router.post("/stops/:stopId/samples", validate(createSampleSchema), asyncHandler(rb.createSample));
router.patch("/samples/:id", validate(updateSampleSchema), asyncHandler(rb.updateSample));
router.delete("/samples/:id", asyncHandler(rb.deleteSample));

// ─── Orders (metric tonnes) ──────────────────────
router.get("/orders", asyncHandler(rb.listOrders));
router.post("/stops/:stopId/orders", validate(createOrderSchema), asyncHandler(rb.createOrder));
router.patch("/orders/:id", validate(updateOrderSchema), asyncHandler(rb.updateOrder));
router.delete("/orders/:id", asyncHandler(rb.deleteOrder));

router.get("/settings", asyncHandler(rb.getSettings));
router.patch("/settings", requireRole("SUPER_ADMIN", "ADMIN"), validate(putSettingsSchema), asyncHandler(rb.putSettings));

router.get("/prefs", asyncHandler(rb.getPrefs));
router.patch("/prefs", validate(putPrefsSchema), asyncHandler(rb.putPrefs));

// ─── The day record ──────────────────────────────
router.delete("/days/:day/stops/:stopId", asyncHandler(rb.clearDayRow));

// ─── Maintenance ─────────────────────────────────
router.post("/reseed", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(rb.reseed));
router.post("/import", requireRole("SUPER_ADMIN", "ADMIN"), validate(importSchema), asyncHandler(rb.importBook));

export default router;
