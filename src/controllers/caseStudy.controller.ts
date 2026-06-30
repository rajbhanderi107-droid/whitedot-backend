import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { logActivity } from "../services/activity.service.js";
import { AppError } from "../middleware/error.middleware.js";

const CS_KEY = "case_study_products";

/**
 * Returns the stored case-study products blob, or { products: null } when the
 * setting has never been saved (the front-end engine then falls back to its
 * bundled specs.json). Used by both the public and admin read endpoints.
 */
async function readCaseStudies(res: Response) {
  const setting = await prisma.websiteSetting.findUnique({ where: { key: CS_KEY } });
  if (!setting || !setting.value) {
    return sendSuccess(res, { products: null }, "No case-study data in DB — engine uses specs.json fallback");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(setting.value);
  } catch {
    return sendSuccess(res, { products: null }, "Stored case-study data was invalid JSON — using fallback");
  }
  return sendSuccess(res, parsed);
}

export async function getPublicCaseStudies(_req: Request, res: Response) {
  return readCaseStudies(res);
}

export async function getCaseStudies(_req: Request, res: Response) {
  return readCaseStudies(res);
}

export async function updateCaseStudies(req: Request, res: Response) {
  const { products } = req.body ?? {};
  if (!products || typeof products !== "object" || Array.isArray(products)) {
    throw new AppError(400, "VALIDATION_ERROR", "Body must contain a `products` object keyed by product id");
  }
  if (Object.keys(products).length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "`products` cannot be empty");
  }

  const value = JSON.stringify({ products });

  const updated = await prisma.websiteSetting.upsert({
    where: { key: CS_KEY },
    update: { value, type: "JSON", updatedById: req.currentUser!.id },
    create: {
      key: CS_KEY,
      value,
      type: "JSON",
      description: "Case-study product data (specs, composition, TDS) served to the public case-study pages.",
      updatedById: req.currentUser!.id,
    },
  });

  await logActivity({
    userId: req.currentUser!.id,
    action: "UPDATE_CASE_STUDIES",
    entityType: "WEBSITE_SETTING",
    entityId: updated.id,
    metadata: { key: CS_KEY, productCount: Object.keys(products).length },
  });

  return sendSuccess(res, { products }, "Case studies saved");
}
