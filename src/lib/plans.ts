export type PlanId     = 'solo' | 'business' | 'cabinet' | 'enterprise';
export type PlanStatus = 'free' | 'trialing' | 'active' | 'canceled' | 'past_due';

/** Issued invoices per calendar month on the free Solo plan (drafts don't count). Enforced in the database: supabase/migrations/20261111_solo_limit_and_plan_protection.sql */
export const SOLO_INVOICE_LIMIT = 5;

export const PLAN_ORDER: PlanId[] = ['solo', 'business', 'cabinet', 'enterprise'];

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------
// Solo: basic DGI-compliant accounting + financial statements (non-certified).
// Business: full SYSCOHADA certification, unlimited invoicing, AI reminders.
// Cabinet: multi-entity, period closing, fixed assets.
// Enterprise: ERP integrations, unlimited team members.

export type Feature =
  | 'invoices_unlimited'    // Business+ (Solo capped at 5 issued invoices/month)
  | 'quotes'                // Business+
  | 'ai_reminders'          // Business+ (moved from Solo in new pricing)
  | 'payments_mobilemoney'  // Business+
  | 'accounting_syscohada'  // Business+ (Solo = DGI-compliant only, non-certified)
  | 'reports'               // Business+
  | 'team_members'          // Business+ (up to 3)
  | 'multi_entity'          // Cabinet+
  | 'period_closing'        // Cabinet+
  | 'fixed_assets'          // Cabinet+
  | 'role_access'           // Cabinet+
  | 'team_unlimited'        // Enterprise
  | 'erp_api';              // Enterprise

const FEATURE_MIN_PLAN: Record<Feature, PlanId> = {
  invoices_unlimited:   'business',
  quotes:               'business',
  payments_mobilemoney: 'business',
  accounting_syscohada: 'business',
  reports:              'business',
  team_members:         'business',
  ai_reminders:         'cabinet',
  multi_entity:         'cabinet',
  period_closing:       'cabinet',
  fixed_assets:         'cabinet',
  role_access:          'cabinet',
  team_unlimited:       'enterprise',
  erp_api:              'enterprise',
};

export function hasFeature(plan: PlanId, feature: Feature): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(FEATURE_MIN_PLAN[feature]);
}

export function minPlanForFeature(feature: Feature): PlanId {
  return FEATURE_MIN_PLAN[feature];
}

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export interface PlanDef {
  id:       PlanId;
  name:     string;
  tagline:  string;
  price:    number | null; // null = on-quote
  /** Price when paid yearly, shown next to the monthly price */
  annualPrice?: number;
  currency: string;
  ctaLabel: string;
  popular:  boolean;
  /** One line each on the pricing cards: keep them short (≈ 24 characters) */
  perks:    string[];
}

export const PLANS: PlanDef[] = [
  {
    id:       'solo',
    name:     'Solo',
    tagline:  'Pour facturer proprement et démarrer en douceur.',
    price:    0,
    currency: 'XOF',
    ctaLabel: 'Commencer gratuitement',
    popular:  false,
    perks: [
      '5 factures émises / mois',
      'Brouillons illimités',
      'Clients & produits',
      'Suivi TVA de base',
      'Comptabilité SYSCOHADA',
    ],
  },
  {
    id:       'business',
    name:     'Business',
    tagline:  'Zéro stress à la clôture, serein face à la DGI.',
    price:    25_000,
    annualPrice: 300_000,
    currency: 'XOF',
    ctaLabel: 'Essai 14 jours gratuit',
    popular:  true,
    perks: [
      'Factures illimitées',
      'Devis illimités',
      'Conforme SYSCOHADA',
      'États financiers',
      'Déclarations TVA',
      "3 membres d'équipe",
      'Relances WhatsApp & email',
    ],
  },
  {
    id:       'cabinet',
    name:     'Cabinet',
    tagline:  'Pour les cabinets, serein sur tous vos dossiers clients.',
    price:    45_000,
    currency: 'XOF',
    ctaLabel: 'Contacter les ventes',
    popular:  false,
    perks: [
      'Tout le plan Business',
      'Espace multi-entités',
      'Clôture de période',
      'Immobilisations',
      'Rappels de paiement IA',
      'Accès par rôles',
      'Support prioritaire',
    ],
  },
  {
    id:       'enterprise',
    name:     'Enterprise',
    tagline:  'Déploiement sur-mesure pour grands comptes.',
    price:    null,
    currency: 'XOF',
    ctaLabel: 'Demander une démo',
    popular:  false,
    perks: [
      'Tout le plan Cabinet',
      'Intégration Odoo',
      'Intégration Sage 100',
      'SLA & support dédié',
      'Onboarding & formation',
      'Équipe illimitée',
    ],
  },
];

/**
 * Certified electronic invoicing (FEC / SECeF), not available yet (PRO-137).
 * Annual only, nothing up front; re-certification is Billio's cost, not the
 * customer's. Shown on the pricing pages as "coming soon".
 */
export const CERTIFIED_OFFER = {
  name:        'Facture certifiée DGI',
  badge:       'Bientôt',
  annualPrice: 450_000,
  currency:    'XOF',
  points: [
    'QR code et n° SECeF sur chaque facture',
    "Aucun frais d'installation",
    'Mises à jour DGI incluses',
  ],
  ctaLabel:    'Être prévenu',
} as const;

export const PLAN_LABELS: Record<PlanId, string> = {
  solo:       'Solo',
  business:   'Business',
  cabinet:    'Cabinet',
  enterprise: 'Enterprise',
};

const FMT = new Intl.NumberFormat('fr-FR');
export function formatPrice(price: number): string {
  return FMT.format(price);
}
