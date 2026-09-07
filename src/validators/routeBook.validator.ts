import { z } from "zod";

// ─── LIMEX Route Book ────────────────────────────

/** Calendar day as the salesperson sees it (their local date), YYYY-MM-DD. */
export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const OUTCOMES = ["int", "smp", "later", "noans", "dead"] as const;
/** Where a company sits in the sale. One field, three books. */
export const STAGES = ["PROSPECT", "LEAD", "CUSTOMER", "LOST"] as const;
export const ORDER_STATUSES = ["CONFIRMED", "DISPATCHED", "DELIVERED", "PAID", "CANCELLED"] as const;
export const FITS = ["prime", "good", "weak", "channel", "no", "clear"] as const;

const text = (max: number) => z.string().max(max);

/** Everything a salesperson can set on one stop. All fields optional so a
 *  PATCH carries only what changed; `null` clears a field. */
export const markFieldsSchema = z.object({
  ticked: z.boolean().optional(),
  tickedOn: dayString.nullable().optional(),
  starred: z.boolean().optional(),
  note: text(4000).nullable().optional(),
  outcome: z.enum(OUTCOMES).nullable().optional(),
  dueOn: dayString.nullable().optional(),
  contactName: text(200).nullable().optional(),
  contactPhone: text(30).nullable().optional(),
  addrOverride: text(1000).nullable().optional(),
  addrPrecise: z.boolean().nullable().optional(),
  dnc: z.boolean().optional(),
  removed: z.boolean().optional(),
  dupOf: text(80).nullable().optional(),
  snoozedOn: dayString.nullable().optional(),
  companyId: text(60).nullable().optional(),
  followUpId: text(60).nullable().optional(),

  // Fit profile — the facts that decide whether LIMEX suits the plant.
  polymers: text(120).nullable().optional(),
  processes: text(120).nullable().optional(),
  monthlyTonnes: z.number().min(0).max(100000).nullable().optional(),
  machines: z.number().int().min(0).max(10000).nullable().optional(),
  fillerPct: z.number().int().min(0).max(100).nullable().optional(),
  resinRate: z.number().min(0).max(100000).nullable().optional(),
  thinWall: z.boolean().nullable().optional(),
  profiledOn: dayString.nullable().optional(),

  // Lifecycle. `stage` is what decides which of the three books shows this
  // company, so it travels with the marks and works offline like everything
  // else the salesperson does on the road.
  stage: z.enum(STAGES).optional(),
  leadOn: dayString.nullable().optional(),
  customerOn: dayString.nullable().optional(),
  lostOn: dayString.nullable().optional(),
  lostReason: text(400).nullable().optional(),
  nextStep: text(400).nullable().optional(),
  expectedMt: z.number().min(0).max(1_000_000).nullable().optional(),
  quotedRate: z.number().min(0).max(100000).nullable().optional(),
  gstNumber: text(20).nullable().optional(),
  billTo: text(1000).nullable().optional(),
  shipTo: text(1000).nullable().optional(),
  paymentTerms: text(200).nullable().optional(),
}).strip();

export const SAMPLE_RESULTS = ["PENDING", "PASS", "PARTIAL", "FAIL"] as const;

export const createSampleSchema = z.object({
  grade: text(80),
  kg: z.number().min(0).max(100000),
  givenOn: dayString.optional(),
  contactName: text(200).nullable().optional(),
  trialDueOn: dayString.nullable().optional(),
  result: z.enum(SAMPLE_RESULTS).optional(),
  resultOn: dayString.nullable().optional(),
  resultNote: text(2000).nullable().optional(),
}).strip();

export const updateSampleSchema = createSampleSchema.partial().strip();

export const putSettingsSchema = z.object({
  limexRate: z.number().min(0).max(100000).nullable().optional(),
  substitutionPct: z.number().int().min(0).max(100).optional(),
  currency: text(8).optional(),
}).strip();

/** An order, in metric tonnes — the unit LIMEX is actually sold in. */
export const createOrderSchema = z.object({
  grade: text(80).min(1, "Grade is required"),
  quantityMt: z.number().min(0.001, "Quantity must be more than zero").max(1_000_000),
  rate: z.number().min(0).max(100000).nullable().optional(),
  orderedOn: dayString.optional(),
  dispatchOn: dayString.nullable().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  poRef: text(80).nullable().optional(),
  note: text(2000).nullable().optional(),
}).strip();

export const updateOrderSchema = createOrderSchema.partial().strip();

export const patchMarkSchema = markFieldsSchema.extend({ day: dayString.optional() }).strip();

// sanitizeBody caps request arrays at 50 entries — bulk calls are chunked to match.
export const bulkMarksSchema = z.object({
  day: dayString.optional(),
  items: z.array(markFieldsSchema.extend({ stopId: z.string().min(1).max(80) })).min(1).max(50),
}).strip();

export const patchLegMarkSchema = z.object({
  ticked: z.boolean().optional(),
  starred: z.boolean().optional(),
  note: text(2000).nullable().optional(),
  day: dayString.optional(),
}).strip();

export const stopFieldsSchema = z.object({
  name: z.string().min(1, "Company name is required").max(200),
  addr: text(300).optional(),
  tel: text(30).optional(),
  makes: text(400).optional(),
  fit: z.enum(FITS).optional(),
  legId: text(10).optional(),
}).strip();

export const createStopSchema = stopFieldsSchema.extend({ day: dayString.optional() }).strip();
export const bulkStopsSchema = z.object({
  day: dayString.optional(),
  items: z.array(stopFieldsSchema).min(1).max(50),
}).strip();
export const updateStopSchema = stopFieldsSchema.partial().omit({ legId: true }).strip();

export const createViewSchema = z.object({
  name: z.string().min(1).max(80),
  filters: z.record(z.unknown()),
}).strip();

export const putPrefsSchema = z.object({
  data: z.record(z.unknown()),
}).strip();

export const eventsQuerySchema = z.object({
  day: dayString.optional(),
  from: dayString.optional(),
  to: dayString.optional(),
  stopId: z.string().max(80).optional(),
}).strip();

export type MarkFields = z.infer<typeof markFieldsSchema>;
export type StopFields = z.infer<typeof stopFieldsSchema>;
