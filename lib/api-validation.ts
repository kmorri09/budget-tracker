import { z } from "zod";

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD").refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Date is invalid");

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  institution: z.string().trim().min(1).max(80),
  type: z.enum(["checking", "savings", "credit_card"]),
  openingBalance: z.coerce.number().finite().default(0),
  syncEnabled: z.boolean().default(false),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().max(4).default(""),
  target: z.coerce.number().finite().nonnegative().default(0),
  active: z.boolean().default(true),
});
export const categoryUpdateSchema = categorySchema.extend({ id: z.string().min(1) });

export const entrySchema = z.object({
  kind: z.enum(["transaction", "income", "allocation", "transfer", "payment"]),
  amount: z.coerce.number().finite().refine(value => value !== 0, "Amount cannot be zero"),
  date: dateOnlySchema,
  accountId: z.string().min(1).optional(),
  categoryId: z.string().optional().nullable(),
  fromCategoryId: z.string().optional().nullable(),
  toCategoryId: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(200),
}).superRefine((input, context) => {
  if (input.kind !== "allocation" && input.amount <= 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Amount must be greater than zero" });
});

export const transactionKindSchema = z.enum(["expense", "income", "refund", "card_payment", "transfer_in", "transfer_out", "adjustment"]);
export const transactionUpdateSchema = z.object({
  id: z.string().min(1),
  kind: transactionKindSchema,
  amount: z.coerce.number().positive().finite(),
  date: dateOnlySchema,
  accountId: z.string().min(1),
  categoryId: z.string().min(1).nullable(),
  description: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(40),
  pending: z.boolean(),
  rememberCategory: z.boolean().optional().default(false),
  categoryRuleMatch: z.string().trim().max(120).optional(),
});

export const allocationUpdateSchema = z.object({
  id: z.string().min(1),
  amount: z.coerce.number().finite().refine(value => value !== 0, "Amount cannot be zero"),
  date: dateOnlySchema,
  categoryId: z.string().min(1),
  note: z.string().trim().max(200),
});
export const idSchema = z.object({ id: z.string().min(1) });

export const budgetAdjustmentUpdateSchema = z.object({
  id: z.string().min(1),
  amount: z.coerce.number().finite().refine(value => value !== 0, "Amount cannot be zero"),
  date: dateOnlySchema,
  note: z.string().trim().min(1).max(200),
});

export const applicationSchema = z.object({ transactionId: z.string().min(1), amount: z.coerce.number().positive().finite() });
export const paymentSchema = z.object({
  amount: z.coerce.number().positive().finite(),
  date: dateOnlySchema,
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  description: z.string().trim().min(1).max(200),
  applications: z.array(applicationSchema).optional(),
});
export const paymentUpdateSchema = paymentSchema.extend({ id: z.string().min(1), applications: z.array(applicationSchema) });
export const paymentDeleteSchema = z.object({ id: z.string().min(1), suppressProviderTransaction: z.boolean().optional().default(false) });

export const obligationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  amount: z.coerce.number().positive().finite(),
  dueDate: dateOnlySchema,
  categoryId: z.string().min(1),
  accountId: z.string().min(1),
  cadence: z.string().trim().max(40).optional().nullable().transform(value => value || null),
  active: z.boolean().default(true),
});
export const obligationUpdateSchema = obligationSchema.extend({ id: z.string().min(1) });
