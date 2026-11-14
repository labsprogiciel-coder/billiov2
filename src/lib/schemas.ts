import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const invoiceStatusSchema = z.enum(['paid', 'pending', 'overdue', 'draft']);
export const clientStatusSchema  = z.enum(['active', 'lead', 'inactive']);
export const payMethodSchema     = z.enum(['cash', 'wire', 'momo', 'cheque']);
export const paySourceSchema     = z.enum(['online', 'manual']);
export const payStatusSchema     = z.enum(['completed', 'pending', 'failed']);
export const productTypeSchema   = z.enum(['service', 'product']);
export const quoteStatusSchema   = z.enum(['draft', 'sent', 'accepted', 'declined', 'expired', 'invoiced']);
export const activityKindSchema  = z.enum(['paid', 'sent', 'overdue', 'viewed', 'avoir']);

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

export const lineItemSchema = z.object({
  id:        z.string(),
  desc:      z.string(),
  unit:      z.string().default('unité'),
  qty:       z.number().min(0),
  price:     z.number().min(0),
  productId: z.string().optional(),
});

export const invoiceSchema = z.object({
  id:          z.string(),
  subject:     z.string(),
  client:      z.string(),
  issued:      z.string(),
  due:         z.string(),
  amount:      z.number().min(0),
  status:      invoiceStatusSchema,
  discountPct: z.number().min(0).max(100).default(0),
  /** When the invoice was first issued (set by the database); counts toward the Solo limit */
  firstIssuedAt: z.string().optional(),
  /** Legal number (FACT-2026-0001), given by the database when the invoice is issued; none for drafts */
  number:      z.string().optional(),
  /** Who issued it (set by the database at first issue): the operator mention */
  issuedByName: z.string().optional(),
  /** « Responsable »: the team member in charge (PRO-172), set and named by the database */
  ownerId:     z.string().optional(),
  ownerName:   z.string().optional(),
});

export const serviceWithholdingScenarioSchema = z.enum([
  'resident-with-ifu',
  'resident-without-ifu',
  'construction',
  'non-resident',
]);

export const clientSchema = z.object({
  name:                z.string(),
  city:                z.string(),
  av:                  z.string(),
  country:             z.string().optional(),
  contact:             z.string().optional(),
  email:               z.string().optional(),
  phone:               z.string().optional(),
  ifu:                 z.string().optional(),
  rccm:                z.string().optional(),
  taxRegime:           z.string().optional(),
  fiscalDivision:      z.string().optional(),
  withholdingScenario: serviceWithholdingScenarioSchema.optional(),
  clientType:          z.enum(['CC', 'PM', 'PP', 'PC']).optional(),
});

export const clientRecordSchema = z.object({
  code:                z.string(),
  av:                  z.string(),
  name:                z.string(),
  contact:             z.string(),
  email:               z.string(),
  phone:               z.string(),
  city:                z.string(),
  country:             z.string().optional(),
  ifu:                 z.string().optional(),
  rccm:                z.string().optional(),
  taxRegime:           z.string().optional(),
  fiscalDivision:      z.string().optional(),
  withholdingScenario: serviceWithholdingScenarioSchema.optional(),
  /** DGI client type (see src/lib/client-type.ts); inferred from the IFU when missing */
  clientType:          z.enum(['CC', 'PM', 'PP', 'PC']).optional(),
  invoices:            z.number().int().min(0),
  billed:              z.number().min(0),
  balance:             z.number().min(0),
  status:              clientStatusSchema,
  /** « Responsable »: the team member in charge (PRO-172), set and named by the database */
  ownerId:     z.string().optional(),
  ownerName:   z.string().optional(),
});

export const paymentSchema = z.object({
  id:     z.string(),
  date:   z.string(),
  client: z.string(),
  inv:    z.string(),
  method: payMethodSchema,
  ref:    z.string(),
  amount: z.number().min(0),
  status: payStatusSchema,
  source: paySourceSchema.default('manual'),
});

export const productSchema = z.object({
  id:    z.string(),
  name:  z.string(),
  sku:   z.string(),
  type:  productTypeSchema,
  unit:  z.string(),
  price: z.number().min(0),
  tax:   z.number().min(0).max(100),
  used:  z.number().int().min(0),
  ico:   z.string(),
  color: z.string(),
});

export const creditNoteSchema = z.object({
  id:        z.string(),
  invoiceId: z.string(),
  subject:   z.string(),
  client:    z.string(),
  issued:    z.string(),
  amount:    z.number().min(0),
  reason:    z.string(),
  /** Legal number (AV-2026-0001), given by the database */
  number:    z.string().optional(),
});

export const quoteSchema = z.object({
  id:      z.string(),
  subject: z.string(),
  client:  z.string(),
  issued:  z.string(),
  valid:   z.string(),
  expSoon: z.boolean(),
  amount:  z.number().min(0),
  status:  quoteStatusSchema,
  /** « Responsable »: the team member in charge (PRO-172), set and named by the database */
  ownerId:     z.string().optional(),
  ownerName:   z.string().optional(),
});

export const activityPartSchema = z.object({
  text: z.string(),
  bold: z.literal(true).optional(),
});

export const activitySchema = z.object({
  kind:  activityKindSchema,
  parts: z.array(activityPartSchema),
  time:  z.string(),
});

// ---------------------------------------------------------------------------
// Form schemas (with validation messages)
// ---------------------------------------------------------------------------

export const newClientFormSchema = z.object({
  name:                z.string().min(1, 'La raison sociale est requise'),
  contact:             z.string(),
  email:               z.union([z.string().email('Email invalide'), z.literal('')]),
  phone:               z.string(),
  city:                z.string(),
  country:             z.string().default('Burkina Faso'),
  status:              clientStatusSchema,
  ifu:                 z.string(),
  rccm:                z.string(),
  taxRegime:           z.string(),
  fiscalDivision:      z.string(),
  withholdingScenario: serviceWithholdingScenarioSchema.optional(),
  clientType:          z.enum(['CC', 'PM', 'PP', 'PC']).optional(),
});

export const lineItemFormSchema = lineItemSchema.omit({ id: true }).extend({
  desc: z.string().min(1, 'Description requise'),
  qty:  z.number().positive('La quantité doit être positive'),
});

export const newInvoiceFormSchema = z.object({
  client:    z.string().min(1, 'Sélectionnez un client'),
  date:      z.string().min(1, 'Date requise'),
  due:       z.string().min(1, "Date d'échéance requise"),
  subject:   z.string(),
  lineItems: z.array(lineItemSchema).min(1, 'Ajoutez au moins une ligne de facturation'),
  payMethod: z.string().min(1, 'Mode de paiement requis'),
  notes:     z.string(),
}).refine(
  data => data.lineItems.reduce((s, li) => s + li.qty * li.price, 0) > 0,
  { message: 'Le total doit être supérieur à 0', path: ['lineItems'] },
);

export const newPaymentFormSchema = z.object({
  method: payMethodSchema,
  invId:  z.string().min(1, 'Sélectionnez une facture'),
  amount: z.number().positive('Le montant doit être supérieur à 0'),
  ref:    z.string(),
  date:   z.string().min(1, 'Date requise'),
  source: paySourceSchema.default('manual'),
});

export const newProductFormSchema = z.object({
  type:  productTypeSchema,
  name:  z.string().min(1, "Donnez un nom à l'article"),
  sku:   z.string(),
  desc:  z.string(),
  price: z.number().min(0, 'Prix invalide'),
  unit:  z.string().min(1, 'Unité requise'),
  tax:   z.number().min(0).max(100, 'TVA invalide'),
});

export const newQuoteFormSchema = z.object({
  client:  z.string().min(1, 'Sélectionnez un client'),
  date:    z.string().min(1, 'Date requise'),
  valid:   z.string().min(1, 'Date de validité requise'),
  subject: z.string(),
  lines:   z.array(lineItemSchema).min(1, 'Ajoutez au moins un article'),
}).refine(
  data => data.lines.reduce((s, li) => s + li.qty * li.price, 0) > 0,
  { message: 'Le total doit être supérieur à 0', path: ['lines'] },
);

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type ServiceWithholdingScenario = z.infer<typeof serviceWithholdingScenarioSchema>;
export type InvoiceStatus  = z.infer<typeof invoiceStatusSchema>;
export type ClientStatus   = z.infer<typeof clientStatusSchema>;
export type PayMethod      = z.infer<typeof payMethodSchema>;
export type PaySource      = z.infer<typeof paySourceSchema>;
export type PayStatus      = z.infer<typeof payStatusSchema>;
export type ProductType    = z.infer<typeof productTypeSchema>;
export type QuoteStatus    = z.infer<typeof quoteStatusSchema>;
export type ActivityKind   = z.infer<typeof activityKindSchema>;

export type LineItem       = z.infer<typeof lineItemSchema>;
export type Invoice        = z.infer<typeof invoiceSchema>;
export type Client         = z.infer<typeof clientSchema>;
export type ClientRecord   = z.infer<typeof clientRecordSchema>;
export type Payment        = z.infer<typeof paymentSchema>;
export type Product        = z.infer<typeof productSchema>;
export type CreditNote     = z.infer<typeof creditNoteSchema>;
export type Quote          = z.infer<typeof quoteSchema>;
export type ActivityPart   = z.infer<typeof activityPartSchema>;
export type Activity       = z.infer<typeof activitySchema>;

export type NewClientForm  = z.infer<typeof newClientFormSchema>;
export type NewInvoiceForm = z.infer<typeof newInvoiceFormSchema>;
export type NewPaymentForm = z.infer<typeof newPaymentFormSchema>;
export type NewProductForm = z.infer<typeof newProductFormSchema>;
export type NewQuoteForm   = z.infer<typeof newQuoteFormSchema>;
