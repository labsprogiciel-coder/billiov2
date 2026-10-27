// Product modules that can be switched on per deployment.

/**
 * The accounting module (Comptabilité pages, supplier bills, accountant
 * shortcuts) is off unless VITE_ENABLE_ACCOUNTING=true, while the product
 * focuses on billing. Journal entries are still written in the background when
 * invoices and payments are recorded, so the books are complete if it is
 * switched back on.
 */
export const ACCOUNTING_ENABLED = import.meta.env.VITE_ENABLE_ACCOUNTING === 'true';
