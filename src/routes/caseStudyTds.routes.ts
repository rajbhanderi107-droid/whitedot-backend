import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildTdsPdf, getTdsDatabase, safeFileName } from "../services/caseStudyTds.service.js";

const router = Router();
router.use((_req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "Vary": "Authorization, Cookie" });
  next();
});
router.get("/:productId", requireAuth, requireRole("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const id = String(req.params.productId);
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,79}$/.test(id)) throw new AppError(404, "NOT_FOUND", "Technical data sheet not found");
  const db = await getTdsDatabase();
  const p = Object.hasOwn(db.products, id) ? db.products[id] : undefined;
  if (!p || p.tdsAvailable === false || !p.specs.length) throw new AppError(404, "NOT_FOUND", "Technical data sheet not available for this product");
  const pdf = buildTdsPdf(p, db);
  res.type("application/pdf");
  res.attachment(`White-Dot-TDS-${safeFileName(p.name)}-${safeFileName(p.mixRatio || p.referenceGrade || "LIMEX")}.pdf`);
  res.send(pdf);
}));
export default router;
