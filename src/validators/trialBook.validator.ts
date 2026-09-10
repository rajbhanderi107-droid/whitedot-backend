import { z } from "zod";

/* The fifteen heads of the trial form, in the workbook's own order. Every one
 * of them is free text: the workbook has always held text there ("NA", "48.4gm",
 * "1250gm  TRIAL BATCH"), and forcing a number here would only lose what Raj
 * actually wrote. */
const head = z.string().trim().max(2000).optional();

export const trialFields = {
  projectBackground: head,
  mouldingProcess: head,
  limexGrade: head,
  mixBatch: head,
  mixResin: head,
  mixLimex: head,
  colouring: head,
  product: head,
  brandOwner: head,
  originalResin: head,
  barrelTemp: head,
  originalWeight: head,
  trialWeight: head,
  result: head,
  problems: head,
  nextStep: head,

  imageName: z.string().trim().max(300).optional(),
  imageDriveUrl: z.string().trim().url().max(600).optional().or(z.literal("")),
  imageLocal: z.string().trim().max(600).optional(),

  stopId: z.string().trim().max(120).optional(),
  company: z.string().trim().max(200).optional(),
  trialOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "trialOn must be YYYY-MM-DD").optional(),
};

/** A trial is worth recording once it says which product it was. Everything
 *  else can be filled in later, exactly as the paper form is. */
export const createTrialSchema = z.object({
  body: z.object({ ...trialFields, product: z.string().trim().min(1, "product is required").max(2000) }),
});

export const updateTrialSchema = z.object({
  body: z.object(trialFields),
});

/** What the laptop reports back once it has written the workbook out. */
export const markSyncedSchema = z.object({
  body: z.object({ fileName: z.string().trim().min(1).max(400) }),
});

export type TrialFields = z.infer<z.ZodObject<typeof trialFields>>;
