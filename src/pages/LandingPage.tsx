import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PLANS, formatPrice, type PlanDef } from '@/lib/plans';
import BillioMark from '@/components/BillioMark';
import SampleInvoice from '@/components/SampleInvoice';
import './LandingPage.css';

const Check = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
);

const FeatureIcon = ({ children }: { children: React.ReactNode }) => (
  <span className="lp-feature-icon">
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  </span>
);

function Brand({ small = false }: { small?: boolean }) {
  return (
    <>
      <span className={`lp-brand-mark${small ? ' lp-brand-mark--sm' : ''}`}><BillioMark size={small ? 19 : 22} /></span>
      <span className="lp-brand-name">Billio</span>
    </>
  );
}

const CHECKS = [
  { title: 'Rien ne manque', text: 'Si une mention obligatoire est vide, Billio vous prévient et vous dit laquelle.' },
  { title: 'Des numéros sans trou', text: 'Chaque facture émise prend le numéro suivant de l’exercice. Les brouillons n’en consomment pas.' },
  { title: 'Le bon type de client', text: 'Entreprise, commerçant ou particulier : Billio demande les informations qui conviennent à chacun.' },
  { title: 'Une erreur ? Un avoir', text: 'Une facture émise ne se modifie plus. Vous la corrigez par un avoir, rattaché à la facture d’origine.' },
];

const FEATURES: { title: string; text: string; icon: React.ReactNode }[] = [
  { title: 'Factures', text: 'Préparez un brouillon, vérifiez-le, puis émettez la facture en PDF.',
    icon: <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M9 13h6M9 17h6" /></> },
  { title: 'Devis', text: 'Envoyez un devis. Une fois accepté, il devient une facture en un clic.',
    icon: <><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1.5" /><path d="M9 14l2 2 4-4" /></> },
  { title: 'Avoirs', text: 'Annulez tout ou partie d’une facture. Billio limite l’avoir à ce qui reste à créditer.',
    icon: <><path d="M9 14l-4-4 4-4" /><path d="M5 10h9a5 5 0 0 1 0 10h-3" /></> },
  { title: 'Paiements', text: 'Enregistrez les paiements, même partiels. Vous voyez ce qui reste dû et ce qui est en retard.',
    icon: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></> },
  { title: 'Modèles de facture', text: 'Votre logo, vos couleurs, vos sections. Les mentions obligatoires restent en place.',
    icon: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16M9 9v11" /></> },
  { title: 'Clients et produits', text: 'Saisis une fois, repris sur chaque document, avec leurs prix et leur TVA.',
    icon: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6" /></> },
];

const ACCOUNTING = ['Journaux et plan comptable', 'Balance générale', 'Résultat et bilan', 'TVA mois par mois', 'Clôture des mois', 'Immobilisations'];

function PlanCard({ plan }: { plan: PlanDef }) {
  return (
    <div className={`lp-plan${plan.popular ? ' lp-plan--popular' : ''}`}>
      <div className="lp-plan-head">
        <h3>{plan.name}</h3>
        {plan.popular && <span className="lp-plan-badge">Le plus choisi</span>}
      </div>
      <p className="lp-plan-tagline">{plan.tagline}</p>
      <div className="lp-plan-price">
        {plan.price === null
          ? <span className="lp-plan-amount">Sur devis</span>
          : <><span className="lp-plan-amount">{formatPrice(plan.price)}</span><span className="lp-plan-per">F CFA / mois</span></>}
      </div>
      <Link to="/signup" className={`lp-btn ${plan.popular ? 'lp-btn--brand' : 'lp-btn--outline'} lp-plan-cta`}>{plan.ctaLabel}</Link>
      <ul className="lp-plan-perks">
        {plan.perks.map(p => <li key={p}><Check />{p}</li>)}
      </ul>
    </div>
  );
}

export default function LandingPage() {
  const { hash } = useLocation();
  // A link from another page (« /#tarifs ») lands on its section
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="lp" id="top">
      <div className="lp-navy">
        <header className="lp-wrap lp-header">
          <a href="#top" className="lp-brand"><Brand /></a>
          <nav aria-label="Navigation principale" className="lp-nav">
            <a href="#conformite">Conformité</a>
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#tarifs">Tarifs</a>
          </nav>
          <div className="lp-header-cta">
            <Link to="/login" className="lp-signin">Se connecter</Link>
            <Link to="/signup" className="lp-btn lp-btn--white lp-btn--sm">Commencer gratuitement</Link>
          </div>
        </header>

        <section className="lp-wrap lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-eyebrow--light">Facturation pour les entreprises du Burkina Faso</p>
            <h1>Des factures conformes, sans y penser.</h1>
            <p className="lp-hero-sub">Billio met votre IFU, les mentions obligatoires et un numéro qui se suit sur chaque facture. Vos devis, vos avoirs et vos paiements sont au même endroit.</p>
            <div className="lp-hero-cta">
              <Link to="/signup" className="lp-btn lp-btn--white">Commencer gratuitement</Link>
              <a href="#tarifs" className="lp-btn lp-btn--ghost">Voir les tarifs</a>
            </div>
            <p className="lp-hero-note">Gratuit jusqu’à 5 factures émises par mois. Sans carte bancaire.</p>
          </div>
          <div className="lp-hero-visual"><SampleInvoice /></div>
        </section>
      </div>

      <section id="conformite" className="lp-section lp-section--grey">
        <div className="lp-wrap">
          <div className="lp-section-head">
            <p className="lp-eyebrow">Conformité</p>
            <h2>Billio vérifie la facture avant vous.</h2>
            <p>Une facture incomplète peut être refusée par votre client ou par l’administration. Billio contrôle chaque facture au moment où vous l’émettez.</p>
          </div>
          <div className="lp-checks">
            {CHECKS.map((c, i) => (
              <div key={c.title} className="lp-check">
                <div className="lp-check-num">{String(i + 1).padStart(2, '0')}</div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="fonctionnalites" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-section-head">
            <p className="lp-eyebrow">Fonctionnalités</p>
            <h2>Du devis au paiement, sans ressaisie.</h2>
          </div>
          <div className="lp-features">
            {FEATURES.map(f => (
              <div key={f.title} className="lp-feature">
                <FeatureIcon>{f.icon}</FeatureIcon>
                <div><h3>{f.title}</h3><p>{f.text}</p></div>
              </div>
            ))}
          </div>

          <div className="lp-accounting">
            <div className="lp-accounting-copy">
              <p className="lp-eyebrow lp-eyebrow--light">Comptabilité · plans Business et Cabinet</p>
              <h3>Chaque facture passe son écriture comptable.</h3>
              <p>Vos ventes et vos règlements arrivent dans les journaux, au plan SYSCOHADA. Votre comptable retrouve la balance et la TVA du mois sans rien ressaisir.</p>
            </div>
            <ul className="lp-accounting-list">
              {ACCOUNTING.map(a => <li key={a}><Check />{a}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section id="tarifs" className="lp-section lp-section--grey lp-section--top">
        <div className="lp-wrap">
          <div className="lp-section-head">
            <p className="lp-eyebrow">Tarifs</p>
            <h2>Gratuit pour démarrer. Un prix fixe ensuite.</h2>
            <p>Prix par mois, en francs CFA. Vous changez de plan quand vous voulez.</p>
          </div>
          <div className="lp-plans">
            {PLANS.map(p => <PlanCard key={p.id} plan={p} />)}
          </div>
        </div>
      </section>

      <section className="lp-section lp-final">
        <div className="lp-wrap lp-final-in">
          <div className="lp-final-copy">
            <h2>Émettez votre première facture conforme aujourd’hui.</h2>
            <p>Le plan Solo est gratuit : 5 factures émises par mois, sans carte bancaire.</p>
          </div>
          <div className="lp-final-cta">
            <Link to="/signup" className="lp-btn lp-btn--brand">Créer mon compte</Link>
            <Link to="/login" className="lp-btn lp-btn--outline">Se connecter</Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <div className="lp-footer-about">
            <div className="lp-brand"><Brand small /></div>
            <p>Facturation et comptabilité pour les entreprises du Burkina Faso. Application web, à utiliser sur ordinateur.</p>
          </div>
          <nav aria-label="Pied de page" className="lp-footer-nav">
            <a href="#conformite">Conformité</a>
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#tarifs">Tarifs</a>
            <Link to="/invoice-generator">Générateur de facture</Link>
            <Link to="/login">Se connecter</Link>
          </nav>
        </div>
        <div className="lp-wrap lp-footer-legal">© {new Date().getFullYear()} Billio</div>
      </footer>
    </div>
  );
}
