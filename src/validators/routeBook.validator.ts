import { z } from "zod";

// ─── LIMEX Route Book ────────────────────────────

/** Calendar day as the salesperson sees it (their local date), YYYY-MM-DD. */
export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const OUTCOMES = ["int", "smp", "later", "noans", "dead"] as const;
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
}).strip();

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
