import { jsPDF } from "jspdf";
import { z } from "zod";
import { AppError } from "../middleware/error.middleware.js";

const text = z.string().max(10000);
const citation = { source: text.optional(), verified: z.boolean().optional() };
const productSchema = z.object({
  id: text, tdsAvailable: z.boolean().optional(), index: z.union([text, z.number()]).optional(), name: text,
  category: text.optional(), moulding: text.optional(), application: text.optional(),
  description: text.optional(), tagline: text.optional(), referenceGrade: text.optional(),
  mixRatio: text.optional(), compositionNote: text.optional(), lastUpdated: text.optional(),
  specs: z.array(z.object({ label: text, value: z.union([text, z.number()]), unit: text.optional(), ...citation })).max(200).default([]),
  composition: z.array(z.object({ name: text, pct: z.number().min(0).max(100), color: text.optional(), ...citation })).max(30).default([]),
  highlights: z.array(z.object(citation)).max(30).default([]),
  co2: z.object({ value: text, basis: text, ...citation }).optional(),
});
const databaseSchema = z.object({
  _meta: z.object({ lastResearched: text.optional() }),
  sources: z.record(text), products: z.record(productSchema),
});
export type TdsProduct = z.infer<typeof productSchema>;
export type TdsDatabase = z.infer<typeof databaseSchema>;
const SOURCE_URL = "https://raw.githubusercontent.com/rajbhanderi107-droid/whitedot-limex.in/main/public/case-study/data/specs.json";
const TTL_MS = 60_000;
let cached: { data: TdsDatabase; expires: number } | undefined;
let inFlight: Promise<TdsDatabase> | undefined;

export async function getTdsDatabase(): Promise<TdsDatabase> {
  if (cached && cached.expires > Date.now()) return cached.data;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw new Error("Source unavailable");
      const body = await response.text();
      if (Buffer.byteLength(body) > 2_000_000) throw new Error("Source too large");
      const data = databaseSchema.parse(JSON.parse(body));
      cached = { data, expires: Date.now() + TTL_MS };
      return data;
    } catch {
      throw new AppError(503, "TDS_UNAVAILABLE", "Technical data is temporarily unavailable. Please retry.");
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}

const ORANGE: [number, number, number] = [79, 154, 53];
const INK: [number, number, number] = [17, 17, 17];
const MUTE: [number, number, number] = [68, 68, 68];
const FAINT: [number, number, number] = [111, 111, 111];
const LINE: [number, number, number] = [221, 219, 211];
  export function buildTdsPdf(p: TdsProduct, db: TdsDatabase): Buffer {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const M = 48;
    let y = 0;

    // Header band
    doc.setFillColor(...INK);
    doc.rect(0, 0, W, 96, "F");
    doc.setFillColor(...ORANGE);
    doc.rect(0, 96, W, 3, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("TECHNICAL DATA SHEET", M, 44);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 196);
    doc.text("White Dot  -  Authorized Marketing & Sales - TBM", M, 62);
    doc.setTextColor(119, 194, 93);
    doc.setFontSize(8);
    doc.text("CASE STUDY " + (p.index || "") + "  -  " + (p.mixRatio || p.referenceGrade || ""), M, 78);

    y = 132;

    // Product title
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(30);
    doc.text(p.name, M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTE);
    y += 18;
    const tag = (p.category || "") + "  -  " + (p.moulding || "") + "  -  " + (p.application || "");
    doc.text(tag, M, y);

    // Description
    y += 22;
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTE);
    const desc = doc.splitTextToSize(p.description || p.tagline || "", W - M * 2);
    doc.text(desc, M, y);
    y += desc.length * 12.5 + 14;

    // Composition section
    y = sectionTitle(doc, "MATERIAL COMPOSITION", M, y, W);
    (p.composition || []).forEach((c) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(c.pct + "%", M, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTE);
      doc.text(c.name, M + 46, y);
      // bar
      const bw = 150, bx = W - M - bw;
      doc.setFillColor(...LINE);
      doc.rect(bx, y - 7, bw, 6, "F");
      const col = hexToRgb(c.color) || ORANGE;
      doc.setFillColor(...col);
      doc.rect(bx, y - 7, bw * (c.pct / 100), 6, "F");
      y += 18;
    });
    y += 6;

    // Key formulation summary.
    doc.setFillColor(245, 248, 244);
    doc.roundedRect(M, y, W - M * 2, 58, 8, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(p.mixRatio || "Per lot TDS", M + 16, y + 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTE);
    doc.text(p.compositionNote ? "Conflicting source quantities and percentages: see Formulation discrepancy below." : "Declared formulation for this case study. Grade-level values remain subject to final supplier lot TDS.", M + 16, y + 42);
    y += 78;

    // Specs table
    y = sectionTitle(doc, "SPECIFICATIONS", M, y, W);
    doc.setFontSize(9.5);
    (p.specs || []).forEach((s) => {
      const val = s.value + (s.unit ? " " + s.unit : "");
      const labelWidth = 175;
      const valueWidth = W - M * 2 - labelWidth - 18;
      doc.setFont("helvetica", "normal");
      const labels = doc.splitTextToSize(s.label.toUpperCase(), labelWidth);
      doc.setFont("helvetica", "bold");
      const values = doc.splitTextToSize(val, valueWidth);
      const rowHeight = Math.max(labels.length, values.length) * 12 + 12;
      if (y + rowHeight > 750) { doc.addPage(); y = 60; }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...FAINT);
      doc.text(labels, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INK);
      doc.text(values, W - M, y, { align: "right" });
      // verified tick
      if (s.verified) {
        doc.setFillColor(...ORANGE);
        doc.circle(M - 10, y - 3, 1.6, "F");
      }
      doc.setDrawColor(...LINE);
      doc.line(M, y + rowHeight - 10, W - M, y + rowHeight - 10);
      y += rowHeight;
    });

    // CO2 callout — skipped when the figure is unknown, otherwise a
    // spec-pending product prints an empty highlight box.
    if (p.co2 && p.co2.value) {
      y += 8;
      if (y > 700) { doc.addPage(); y = 60; }
      doc.setFillColor(248, 243, 234);
      doc.roundedRect(M, y - 4, W - M * 2, 56, 6, 6, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(...ORANGE);
      doc.text(p.co2.value, M + 14, y + 20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTE);
      const basis = doc.splitTextToSize(p.co2.basis, W - M * 2 - 120);
      doc.text(basis, M + 110, y + 12);
      y += 70;
    }

    // Sources + disclaimer
    if (y > 660) { doc.addPage(); y = 60; }
    y = sectionTitle(doc, "SOURCES & VERIFICATION", M, y, W);
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    const usedKeys = new Set<string>();
    [...p.specs, ...p.composition, ...p.highlights, p.co2].forEach((x) => x && x.source && usedKeys.add(x.source));
    const srcLines: string[] = [];
    usedKeys.forEach((k) => { if (db.sources[k]) srcLines.push("• " + db.sources[k]); });
    srcLines.push("• Prepared " + (p.lastUpdated || db._meta.lastResearched || "") + ". Photo-reference fields are derived from supplied product images. User-supplied formulation fields are marked unverified until confirmed against final supplier lot TDS.");
    const wrapped = doc.splitTextToSize(srcLines.join("\n"), W - M * 2);
    doc.text(wrapped, M, y);
    y += wrapped.length * 10 + 16;

    // Footer
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINE);
    doc.line(M, H - 50, W - M, H - 50);
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text("(c) 2026 White Dot - LIMEX is a registered trademark of TBM Co., Ltd.", M, H - 34);
    doc.text("Generated " + new Date().toISOString().slice(0, 10) + " - whitedotindia.in", M, H - 22);

    return Buffer.from(doc.output("arraybuffer"));
  }

  function sectionTitle(doc: jsPDF, text: string, M: number, y: number, W: number): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(79, 154, 53);
    doc.text(text, M, y);
    doc.setDrawColor(221, 219, 211);
    doc.line(M, y + 7, W - 48, y + 7);
    return y + 24;
  }

  function hexToRgb(h?: string): [number, number, number] | null {
    if (!h) return null;
    const m = h.replace("#", "");
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  }

  export function safeFileName(s: string) {
    return String(s || "")
      .replace(/%/g, "pct")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

