// Product modules that can be switched on per deployment.

/**
 * The accounting module (Comptabilité pages, supplier bills, accountant
 * shortcuts) is off unless VITE_ENABLE_ACCOUNTING=true, while the product
 * focuses on billing. Journal entries are still written in the background when
 * invoices and payments are recorded, so the books are complete if it is
 * switched back on.
 */
export const ACCOUNTING_ENABLED = import.meta.env.VITE_ENABLE_ACCOUNTING === 'true';

/**
 * The in-app assistant (CopilotKit + Claude, served by the Worker at
 * /api/copilotkit) is off unless VITE_ENABLE_ASSISTANT=true at build time.
 */
export const ASSISTANT_ENABLED = import.meta.env.VITE_ENABLE_ASSISTANT === 'true';

/**
 * The ERP-style interface (PRO-160 and the "Billio — ERP redesign" project) is
 * off unless VITE_UI_V2=true at build time. With it off the app looks exactly
 * as before; pages move to the new look one at a time behind this flag.
 */
export const UI_V2 = import.meta.env.VITE_UI_V2 === 'true';
