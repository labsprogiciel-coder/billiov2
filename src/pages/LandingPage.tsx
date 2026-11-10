import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { CERTIFIED_OFFER, PLANS, formatPrice, type PlanDef } from '@/lib/plans';
import BillioMark from '@/components/BillioMark';
import './LandingPage.css';

/* ── Nav ─────────────────────────────────────────────────── */
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    fn();
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <header className={`lp-nav${scrolled ? ' lp-nav--scrolled' : ''}`}>
      <div className="lp-wrap lp-nav-in">
        <a href="#top" className="lp-brand">
          <span className="lp-brand-icon"><BillioMark size={18} /></span>
          <span className="lp-brand-name">Billio</span>
        </a>
        <nav className="lp-nav-links">
          <a href="#features">Pourquoi Billio</a>
          <a href="#accounting">Conformité</a>
          <a href="#pricing">Tarifs</a>
          <a href="#faq">FAQ</a>
          <Link to="/invoice-generator" className="lp-nav-tool">
            <i className="ti ti-receipt" /> Générateur de factures
          </Link>
        </nav>
        <div className="lp-nav-cta">
          <Link to="/login" className="lp-nav-signin">Connexion</Link>
          <Link to="/login" className="lp-btn lp-btn--primary">
            Commencer <i className="ti ti-arrow-right" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="lp-hero" id="top">
      <div className="lp-wrap lp-hero-grid">
        <div className="lp-hero-copy">
          <div className="lp-eyebrow"><i className="ti ti-shield-check" /> En règle avec la DGI</div>
          <h1>Votre entreprise en règle avec la DGI, <span className="lp-hl">sans même y penser.</span></h1>
          <p className="lp-hero-sub">
            Fini les pénalités et les logiciels compliqués.
          </p>
          <div className="lp-hero-cta">
            <Link to="/login" className="lp-btn lp-btn--primary lp-btn--lg">
              Commencer gratuitement <i className="ti ti-arrow-right" />
            </Link>
            <Link to="/dashboard" className="lp-btn lp-btn--ghost lp-btn--lg">
              <i className="ti ti-player-play" /> Voir la démo
            </Link>
          </div>
        </div>

        <div className="lp-hero-vis">
          <div className="lp-paper">
            <div className="lp-paper-top">
              <div className="lp-paper-biz">
                <div className="lp-paper-logo">SW</div>
                <div>
                  <div className="lp-paper-bizname">Studio Wend SARL</div>
                  <div className="lp-paper-bizmeta">Ouagadougou · Burkina Faso</div>
                </div>
              </div>
              <div className="lp-paper-doc">
                <div className="lp-paper-doctitle">FACTURE</div>
                <div className="lp-paper-docnum">#INV-0042</div>
              </div>
            </div>
            <div className="lp-paper-mid">
              <div>
                <div className="lp-pm-l">Billed to</div>
                <div className="lp-pm-v">Sahel Banque<small>Ouagadougou</small></div>
              </div>
              <div>
                <div className="lp-pm-l">Due</div>
                <div className="lp-pm-v">20 juin 2026<small>Net 14 jours</small></div>
              </div>
            </div>
            <div className="lp-paper-items">
              <div className="lp-pi-row">
                <div><div className="lp-pi-desc">Développement site web</div><div className="lp-pi-qty">1 × 650 000</div></div>
                <div className="lp-pi-amt">650 000</div>
              </div>
              <div className="lp-pi-row">
                <div><div className="lp-pi-desc">Hébergement annuel</div><div className="lp-pi-qty">1 × 120 000</div></div>
                <div className="lp-pi-amt">120 000</div>
              </div>
              <div className="lp-pi-row">
                <div><div className="lp-pi-desc">Hébergement Trimestrielle</div><div className="lp-pi-qty">1 × 120 000</div></div>
                <div className="lp-pi-amt">120 000</div>
              </div>
            </div>
            <div className="lp-paper-tot">
              <div className="lp-pt-row"><span>Sous-total</span><span>770 000</span></div>
              <div className="lp-pt-row"><span>TVA (18%)</span><span>138 600</span></div>
              <div className="lp-pt-row lp-pt-row--grand"><span>Total dû</span><span>908 600 XOF</span></div>
            </div>
          </div>
          <div className="lp-float lp-float--paid">
            <div className="lp-float-ico"><i className="ti ti-circle-check-filled" /></div>
            <div><div className="lp-ft">Paiement reçu · +908 600</div><div className="lp-fs">Orange Money · INV-0042</div></div>
          </div>
          <div className="lp-float lp-float--relance">
            <div className="lp-float-ico"><i className="ti ti-robot" /></div>
            <div><div className="lp-ft">Relance envoyée</div><div className="lp-fs">Rappel IA · WhatsApp</div></div>
          </div>
          <div className="lp-float lp-float--bal">
            <div className="lp-float-ico"><i className="ti ti-shield-check" /></div>
            <div><div className="lp-ft">En règle avec la DGI</div><div className="lp-fs">TVA &amp; SYSCOHADA ✓</div></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Logos ───────────────────────────────────────────────── */
const LOGOS = [
  { icon: 'building',       name: 'Baobab&Co' },
  { icon: 'truck-delivery', name: 'SahelLogistics' },
  { icon: 'coins',          name: 'AgroMali' },
  { icon: 'headset',        name: 'TechKonsult' },
  { icon: 'wave',           name: 'NiayesFresh' },
  { icon: 'building-bank',  name: 'Faso Capital' },
];

function Logos() {
  return (
    <section className="lp-logos">
      <div className="lp-wrap">
        <p className="lp-logos-cap">Plus de 3 000 entreprises sereines face à la DGI, dans 8 pays OHADA</p>
        <div className="lp-logos-row">
          {LOGOS.map(l => (
            <span key={l.name} className="lp-logo-mark">
              <i className={`ti ti-${l.icon}`} />{l.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Value ───────────────────────────────────────────────── */
const VALUE_CARDS = [
  { icon: 'shield-check', color: undefined,  title: 'Toujours en règle', body: 'Chaque opération met à jour vos journaux SYSCOHADA et votre TVA. Vos livres sont prêts pour la DGI, à tout moment.' },
  { icon: 'mood-smile',   color: '--lp-green',  title: 'Zéro pénalité',    body: 'Déclarations à jour, échéances suivies, écritures équilibrées. Plus de risque de redressement.' },
  { icon: 'robot',        color: '--lp-amber',  title: 'Sans être comptable', body: "Pas de jargon ni de double saisie. Vous gérez votre activité ; Billio s'occupe d'une comptabilité 100 % conforme." },
];

function ValueSection() {
  return (
    <section className="lp-section" id="features">
      <div className="lp-wrap">
        <div className="lp-sec-head">
          <div className="lp-eyebrow"><i className="ti ti-layout-grid" /> Pourquoi Billio</div>
          <h2>La conformité, sans la complexité.</h2>
          <p>Les logiciels existants ont été conçus pour des experts-comptables. Billio est conçu pour vous, le dirigeant : chaque facture et chaque paiement met vos livres et votre TVA en règle, automatiquement.</p>
        </div>
        <div className="lp-vgrid">
          {VALUE_CARDS.map(c => (
            <div key={c.title} className="lp-vcard">
              <div
                className="lp-vcard-ico"
                style={c.color ? { background: `var(${c.color}-l)`, color: `var(${c.color})` } : undefined}
              >
                <i className={`ti ti-${c.icon}`} />
              </div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Feature rows ────────────────────────────────────────── */
function FeaturesSection() {
  return (
    <section className="lp-section lp-section--alt">
      <div className="lp-wrap">
        {/* Invoicing */}
        <div className="lp-feat">
          <div className="lp-feat-copy">
            <div className="lp-feat-kick"><i className="ti ti-receipt" /> Facturation conforme</div>
            <h3>Facturez normalement. La conformité suit toute seule.</h3>
            <p>Du devis à la facture en un clic — TVA, IFU, RCCM inclus et comptabilité automatique.</p>
            <ul className="lp-feat-list">
              <li><i className="ti ti-circle-check-filled" /><span>TVA, IFU &amp; RCCM automatiques<small>Des factures conformes, sans y penser</small></span></li>
              <li><i className="ti ti-circle-check-filled" /><span>Mobile Money intégré<small>MTN · Orange · Wave — rapproché automatiquement</small></span></li>
              <li><i className="ti ti-circle-check-filled" /><span>Chaque paiement comptabilisé<small>L'écriture est créée pour vous, dans le bon journal</small></span></li>
            </ul>
          </div>
          <div className="lp-media">
            <div className="lp-media-bar">
              <span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" />
              <span className="lp-mt">Facture INV-0042</span>
            </div>
            <div className="lp-media-body">
              <div className="lp-tl">
                <div className="lp-tl-item">
                  <div className="lp-tl-dot" style={{ background: 'var(--lp-tint)', color: 'var(--lp-brand)' }}><i className="ti ti-send" /></div>
                  <div style={{ flex: 1 }}><div className="lp-tl-t">Facture envoyée</div><div className="lp-tl-s">Sahel Banque · 908 600 XOF</div></div>
                  <div className="lp-tl-time">10:24</div>
                </div>
                <div className="lp-tl-item">
                  <div className="lp-tl-dot" style={{ background: 'var(--lp-amber-l)', color: 'var(--lp-amber)' }}><i className="ti ti-robot" /></div>
                  <div style={{ flex: 1 }}><div className="lp-tl-t">Relance automatique</div><div className="lp-tl-s">Relance amicale · WhatsApp</div></div>
                  <div className="lp-tl-time">J+7</div>
                </div>
                <div className="lp-tl-item">
                  <div className="lp-tl-dot" style={{ background: 'var(--lp-amber-l)', color: 'var(--lp-amber)' }}><i className="ti ti-robot" /></div>
                  <div style={{ flex: 1 }}><div className="lp-tl-t">Relance automatique</div><div className="lp-tl-s">Relance amicale · Email</div></div>
                  <div className="lp-tl-time">J+9</div>
                </div>
                <div className="lp-tl-item">
                  <div className="lp-tl-dot" style={{ background: 'var(--lp-amber-l)', color: 'var(--lp-amber)' }}><i className="ti ti-robot" /></div>
                  <div style={{ flex: 1 }}><div className="lp-tl-t">Relance automatique</div><div className="lp-tl-s">Relance amicale · Tel</div></div>
                  <div className="lp-tl-time">J+12</div>
                </div>
                <div className="lp-tl-item">
                  <div className="lp-tl-dot" style={{ background: 'var(--lp-green-l)', color: 'var(--lp-green)' }}><i className="ti ti-circle-check-filled" /></div>
                  <div style={{ flex: 1 }}><div className="lp-tl-t">Paiement reçu</div><div className="lp-tl-s">Orange Money · +908 600 XOF</div></div>
                  <div className="lp-tl-time">J+16</div>
                </div>
              </div>
              <div className="lp-mtie"><i className="ti ti-circle-check-filled" /> Encaissement comptabilisé · journal BQ</div>
            </div>
          </div>
        </div>

        {/* Accounting */}
        <div className="lp-feat lp-feat--flip" id="accounting">
          <div className="lp-feat-copy">
            <div className="lp-feat-kick"><i className="ti ti-shield-check" /> Conformité SYSCOHADA</div>
            <h3>Une comptabilité prête pour la DGI — sans la faire vous-même.</h3>
            <p>Un vrai moteur SYSCOHADA sous le capot — journaux, grand livre et états financiers toujours à jour, prêts pour un contrôle.</p>
            <ul className="lp-feat-list">
              <li><i className="ti ti-circle-check-filled" /><span>Écritures toujours équilibrées<small>Partie double : débit = crédit, à chaque fois</small></span></li>
              <li><i className="ti ti-circle-check-filled" /><span>Déclarations TVA prêtes<small>TVA à 18 % suivie et prête à déclarer</small></span></li>
              <li><i className="ti ti-circle-check-filled" /><span>États financiers en un clic<small>Bilan, compte de résultat &amp; balance, instantanés</small></span></li>
            </ul>
          </div>
          <div className="lp-media">
            <div className="lp-media-bar">
              <span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" />
              <span className="lp-mt">Balance générale · 2026</span>
            </div>
            <div className="lp-media-body">
              <div className="lp-mrow lp-mrow--head">
                <div /><div className="lp-mh">Compte</div>
                <div className="lp-mh lp-mh--r">Débit</div>
                <div className="lp-mh lp-mh--r">Crédit</div>
              </div>
              {[
                { color: '#185FA5', num: '5', lbl: 'Banques', sub: '521 · Trésorerie', debit: '4 180 000', credit: '—' },
                { color: '#0E8C6A', num: '4', lbl: 'Clients',    sub: '411 · Tiers',      debit: '3 420 000', credit: '—' },
                { color: '#5B45C7', num: '1', lbl: 'Capital social', sub: '101 · Financement', debit: '—', credit: '5 000 000' },
                { color: '#1E6FA8', num: '7', lbl: 'Ventes de services', sub: '706 · Produits', debit: '—', credit: '1 540 000' },
              ].map(r => (
                <div key={r.num} className="lp-mrow">
                  <div className="lp-mtag" style={{ background: r.color }}>{r.num}</div>
                  <div className="lp-mlbl">{r.lbl}<small>{r.sub}</small></div>
                  <div className={`lp-mv${r.debit === '—' ? ' lp-mv--dim' : ''}`}>{r.debit}</div>
                  <div className={`lp-mv${r.credit === '—' ? ' lp-mv--dim' : ''}`}>{r.credit}</div>
                </div>
              ))}
              <div className="lp-mtie"><i className="ti ti-scale" /> Totaux généraux équilibrés · 19 870 000 = 19 870 000</div>
            </div>
          </div>
        </div>

        {/* Free tool CTA */}
        <div className="lp-tool-cta">
          <div className="lp-tool-cta-copy">
            <span className="lp-eyebrow"><i className="ti ti-receipt" /> Outil gratuit</span>
            <h3>Pas encore prêt à vous lancer ? Commencez par une facture.</h3>
            <p>Notre générateur de factures est 100 % gratuit et sans inscription — TVA, IFU, RCCM inclus. Téléchargez en PDF en un clic.</p>
          </div>
          <Link to="/invoice-generator" className="lp-btn lp-btn--primary lp-btn--lg">
            Créer une facture gratuite <i className="ti ti-arrow-right" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── How it works ────────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    { n: '1', title: 'Configurez votre espace',  body: "Renseignez votre entreprise, votre logo et votre TVA. Vous venez d'un autre outil ? Reprenez vos soldes en une seule écriture." },
    { n: '2', title: 'Facturez vos clients',     body: 'Choisissez un client, ajoutez les lignes, envoyez. Le client paie par Mobile Money ou virement, en un geste.' },
    { n: '3', title: 'Restez en règle, sans effort', body: 'Chaque opération se comptabilise au bon endroit. Votre balance et vos déclarations sont toujours prêtes.' },
  ];
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-sec-head">
          <div className="lp-eyebrow"><i className="ti ti-bolt" /> Comment ça marche</div>
          <h2>En règle dès le premier jour.</h2>
          <p>Pas de projet de migration, pas de consultant. Configurez votre espace, facturez, et votre comptabilité se met en règle toute seule.</p>
        </div>
        <div className="lp-steps">
          {steps.map((s, i) => (
            <div key={s.n} className="lp-step">
              <div className="lp-step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              {i < steps.length - 1 && <i className="ti ti-arrow-right lp-step-arrow" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Compliance band ─────────────────────────────────────── */
function ComplianceBand() {
  const chips = [
    {
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          <line x1="9" y1="7" x2="15" y2="7" />
          <line x1="9" y1="11" x2="15" y2="11" />
        </svg>
      ),
      title: 'SYSCOHADA révisé',
      sub: "Plan comptable & journaux prêts à l'emploi",
    },
    {
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="9" />
          <circle cx="9.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      ),
      title: 'TVA & déclarations',
      sub: 'TVA 18 % suivie, prête à déclarer',
    },
    {
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="2" y1="20" x2="22" y2="20" />
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="12" y1="20" x2="12" y2="6" />
          <line x1="18" y1="20" x2="18" y2="10" />
          <polyline points="2 10 8 4 14 10 20 6" />
        </svg>
      ),
      title: 'États financiers',
      sub: 'Bilan & compte de résultat à la demande',
    },
    {
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
      title: '8 pays · XOF',
      sub: "Burkina, Mali, Sénégal, Côte d'Ivoire & plus",
    },
  ];
  return (
    <section className="lp-section lp-section--alt">
      <div className="lp-wrap">
        <div className="lp-band">
          <div className="lp-band-grid">
            <div>
              <div className="lp-eyebrow"><i className="ti ti-shield-check" /> La conformité par défaut</div>
              <h2>La conformité, dans l'ADN du produit.</h2>
              <p>Plan comptable, journaux, TVA, états financiers — tout SYSCOHADA, sans bricolage.</p>
            </div>
            <div className="lp-band-chips">
              {chips.map(c => (
                <div key={c.title} className="lp-bchip">
                  {c.svg}
                  <div className="lp-bt">{c.title}</div>
                  <div className="lp-bs">{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Testimonial ─────────────────────────────────────────── */
function Testimonial() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="lp-quote">
          <div className="lp-quote-mark">"</div>
          <q>Je ne comprends rien à la comptabilité, et je n'ai plus à comprendre. Ma TVA est juste, mes déclarations sont prêtes, et je ne redoute plus un contrôle de la DGI. Billio m'a enlevé une vraie angoisse.</q>
          <div className="lp-quote-by">
            <div className="lp-quote-av">AT</div>
            <div>
              <div className="lp-quote-name">Aïcha Traoré</div>
              <div className="lp-quote-role">Gérante · Niayes Fresh, Dakar</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Pricing ─────────────────────────────────────────────── */
function PricingCard({ plan }: { plan: PlanDef }) {
  const isQuote = plan.price === null;
  return (
    <div className={`lp-plan${plan.popular ? ' lp-plan--pop' : ''}`}>
      {plan.popular && <div className="lp-plan-badge">Le plus populaire</div>}
      <div className="lp-plan-name">{plan.name}</div>
      <div className="lp-plan-desc">{plan.tagline}</div>
      <div className="lp-plan-price">
        {isQuote ? (
          <>
            <span className="lp-amt">Sur devis</span>
            <span className="lp-per">Contrat annuel</span>
          </>
        ) : (
          <>
            <span className="lp-cur">XOF</span>
            <span className="lp-amt">{plan.price === 0 ? '0' : formatPrice(plan.price!)}</span>
            <span className="lp-per">/ mois</span>
            {plan.annualPrice && <span className="lp-annual">ou {formatPrice(plan.annualPrice)} XOF / an</span>}
          </>
        )}
      </div>
      <Link
        to="/login"
        className={`lp-btn${plan.popular ? ' lp-btn--primary' : ' lp-btn--ghost'}`}
      >
        {plan.ctaLabel}
      </Link>
      <ul className="lp-plan-feats">
        {plan.perks.map(perk => (
          <li key={perk} title={perk}>
            <i className="ti ti-circle-check-filled" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingSection() {
  return (
    <section className="lp-section lp-section--alt" id="pricing">
      <div className="lp-wrap">
        <div className="lp-sec-head">
          <div className="lp-eyebrow"><i className="ti ti-tag" /> Tarifs</div>
          <h2>Des prix clairs, une valeur réelle.</h2>
          <p>Pour les entrepreneurs, PME et cabinets comptables en zone UEMOA.</p>
        </div>
        <div className="lp-price-grid">
          {PLANS.map(p => <PricingCard key={p.id} plan={p} />)}
        </div>
        {/* Certified e-invoicing (PRO-137): announced, not sold yet */}
        <div className="lp-certified">
          <div className="lp-certified-main">
            <div className="lp-certified-head">
              <i className="ti ti-shield-check" />
              <span className="lp-certified-name">{CERTIFIED_OFFER.name}</span>
              <span className="lp-certified-badge">{CERTIFIED_OFFER.badge}</span>
            </div>
            <div className="lp-certified-price">
              À partir de <strong>{formatPrice(CERTIFIED_OFFER.annualPrice)} XOF</strong> / an, sans frais d'installation
            </div>
          </div>
          <ul className="lp-certified-points">
            {CERTIFIED_OFFER.points.map(pt => <li key={pt}><i className="ti ti-circle-check-filled" />{pt}</li>)}
          </ul>
          <Link to="/login" className="lp-btn lp-btn--ghost">{CERTIFIED_OFFER.ctaLabel}</Link>
        </div>
        <p className="lp-price-foot">
          Tous les plans incluent clients illimités, sécurité bancaire et export libre de vos données.
        </p>
      </div>
    </section>
  );
}

/* ── FAQ ─────────────────────────────────────────────────── */
const FAQ_ITEMS = [
  { q: 'Faut-il des connaissances en comptabilité ?', a: 'Non. Vous facturez et enregistrez vos paiements comme dans n\'importe quelle application moderne. Billio tient la comptabilité SYSCOHADA en partie double en coulisses — tout est déjà dans les bons journaux, prêt pour la DGI.' },
  { q: 'Billio est-il conforme à la DGI et au SYSCOHADA ?', a: 'Oui. Vos factures portent les mentions obligatoires de la facture normalisée (IFU, RCCM, régime fiscal, TVA…). Billio s\'appuie sur le plan comptable et les journaux SYSCOHADA révisé, suit la TVA à 18 % et génère le bilan et le compte de résultat attendus par l\'administration, dans les 8 pays OHADA couverts. La facture électronique certifiée (SECeF) arrive bientôt, à partir de 450 000 XOF par an, sans frais d\'installation et avec les mises à jour DGI incluses.' },
  { q: 'Et si je viens d\'une autre plateforme ?', a: 'Reprenez vos soldes de clôture en une seule écriture d\'à-nouveaux datée du début de l\'exercice : Billio l\'adopte comme position d\'ouverture, et votre balance démarre de là.' },
  { q: 'Quels moyens de paiement pour mes clients ?', a: 'Mobile Money (MTN, Orange, Wave), virement bancaire et paiement à la livraison. Les paiements Mobile Money et bancaires sont rapprochés automatiquement de la facture correspondante.' },
  { q: "Que se passe-t-il après l'offre gratuite ou l'essai ?", a: "L'offre Solo reste gratuite jusqu'à 5 factures émises par mois ; les brouillons sont illimités. Au-delà, passez à Business quand vous voulez — et exportez vos données à tout moment." },
];

function FAQSection() {
  const [open, setOpen] = useState<number | null>(null);
  const bodyRefs = useRef<(HTMLDivElement | null)[]>([]);

  function toggle(i: number) {
    setOpen(prev => (prev === i ? null : i));
  }

  return (
    <section className="lp-section" id="faq">
      <div className="lp-wrap">
        <div className="lp-sec-head">
          <div className="lp-eyebrow"><i className="ti ti-help-circle" /> FAQ</div>
          <h2>Questions fréquentes.</h2>
        </div>
        <div className="lp-faq">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className={`lp-qa${open === i ? ' lp-qa--open' : ''}`}>
              <button className="lp-qa-q" onClick={() => toggle(i)}>
                {item.q}
                <i className="ti ti-plus" />
              </button>
              <div
                className="lp-qa-body"
                ref={el => { bodyRefs.current[i] = el; }}
                style={{ maxHeight: open === i ? `${bodyRefs.current[i]?.scrollHeight ?? 200}px` : '0' }}
              >
                <div className="lp-qa-body-in">{item.a}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ───────────────────────────────────────────── */
function FinalCTA() {
  return (
    <section className="lp-section lp-cta-final">
      <div className="lp-wrap">
        <div className="lp-cta-card">
          <h2>Mettez votre entreprise en règle, dès aujourd'hui.</h2>
          <p>Rejoignez des milliers d'entreprises de la zone UEMOA, sereines face à la DGI.</p>
          <div className="lp-hero-cta">
            <Link to="/login" className="lp-btn lp-btn--white lp-btn--lg">
              Commencer gratuitement <i className="ti ti-arrow-right" />
            </Link>
            <Link to="/dashboard" className="lp-btn lp-btn--light lp-btn--lg">
              <i className="ti ti-player-play" /> Voir la démo
            </Link>
          </div>
          <div className="lp-trust">
            <span><i className="ti ti-circle-check-filled" /> Sans carte bancaire</span>
            <span><i className="ti ti-circle-check-filled" /> Prêt en 2 minutes</span>
            <span><i className="ti ti-circle-check-filled" /> Sans engagement</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-foot-grid">
          <div className="lp-foot-about">
            <a href="#top" className="lp-brand">
              <span className="lp-brand-icon"><BillioMark size={18} /></span>
              <span className="lp-brand-name">Billio</span>
            </a>
            <p>La conformité SYSCOHADA sans prise de tête, pour les entreprises de la zone UEMOA.</p>
          </div>
          <div className="lp-foot-col">
            <h4>Produit</h4>
            <a href="#features">Pourquoi Billio</a>
            <a href="#accounting">Conformité</a>
            <a href="#pricing">Tarifs</a>
            <Link to="/invoice-generator">Générateur de factures</Link>
          </div>
          <div className="lp-foot-col">
            <h4>Entreprise</h4>
            <a href="#">À propos</a>
            <a href="#">Clients</a>
            <a href="#">Recrutement</a>
            <a href="#">Blog</a>
          </div>
          <div className="lp-foot-col">
            <h4>Support</h4>
            <a href="#faq">Centre d'aide</a>
            <Link to="/login">Connexion</Link>
            <a href="#">Contact</a>
            <a href="#">Statut</a>
          </div>
        </div>
        <div className="lp-foot-bot">
          <p>© 2026 Billio SARL · Ouagadougou, Burkina Faso. Tous droits réservés.</p>
          <div className="lp-foot-social">
            <a href="#" aria-label="WhatsApp"><i className="ti ti-brand-whatsapp" /></a>
            <a href="#" aria-label="Email"><i className="ti ti-mail" /></a>
            <a href="#" aria-label="Phone"><i className="ti ti-phone" /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ── Page ────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="lp">
      <Nav />
      <main>
        <Hero />
        <Logos />
        <ValueSection />
        <FeaturesSection />
        <HowItWorks />
        <ComplianceBand />
        <Testimonial />
        <PricingSection />
        <FAQSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
