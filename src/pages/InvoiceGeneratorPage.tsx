import { useState, useRef, useMemo, useEffect, useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import BillioMark from '@/components/BillioMark';
import { getFiscalIdLabel, getFiscalIdPlaceholder, OHADA_COUNTRY_NAMES } from '@/lib/ohada';
import './InvoiceGeneratorPage.css';

/* ── Types ───────────────────────────────────────────────── */
type Currency = 'XOF' | 'XAF' | 'GNF' | 'CDF' | 'EUR' | 'USD';
type Template = 'classique' | 'bandeau' | 'epure' | 'moderne' | 'encadre';

interface LineItem {
  id: number;
  desc: string;
  qty: string;
  price: string;
}

const CUR_CONFIG: Record<Currency, { dec: number; suffix: string }> = {
  XOF: { dec: 0, suffix: 'FCFA' }, XAF: { dec: 0, suffix: 'FCFA' },
  GNF: { dec: 0, suffix: 'GNF' }, CDF: { dec: 0, suffix: 'CDF' },
  EUR: { dec: 2, suffix: 'EUR' }, USD: { dec: 2, suffix: 'USD' },
};

const LS_KEY = 'billio.invgen.v1';
const SEQ_KEY = 'billio.invgen.seq';
let nextId = 10;

function nextLocalInvNum(): string {
  const n = parseInt(localStorage.getItem(SEQ_KEY) ?? '0', 10) + 1;
  localStorage.setItem(SEQ_KEY, String(n));
  return 'FAC-' + String(n).padStart(4, '0');
}

/* ── Helpers ─────────────────────────────────────────────── */
function toNum(v: string) {
  const n = parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtDate(v: string) {
  if (!v) return '—';
  const d = new Date(v + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function today() { return new Date().toISOString().slice(0, 10); }

function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

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
    <header className={`ig-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="ig-nav-in">
        <Link to="/" className="ig-brand">
          <span className="ig-brand-icon"><BillioMark size={18} /></span>
          <span>Billio</span>
        </Link>
        <nav className="ig-nav-links">
          <Link to="/#fonctionnalites">Pourquoi Billio</Link>
          <Link to="/#tarifs">Tarifs</Link>
        </nav>
        <div className="ig-nav-cta">
          <Link to="/login" className="ig-signin">Connexion</Link>
          <Link to="/login" className="ig-btn ig-btn--primary">
            Commencer <i className="ti ti-arrow-right" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ── Auto-grow textarea ──────────────────────────────────── */
function AutoTextarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => { grow(); }, [props.value, grow]);
  return <textarea ref={ref} className={`inv-ed${className ? ` ${className}` : ''}`} onInput={grow} {...props} />;
}

/* ── Main page ───────────────────────────────────────────── */
export default function InvoiceGeneratorPage() {
  const t0 = today();
  const uid = useId();

  /* ── State ─────────────────────────────────────── */
  const [bizName,     setBizName]     = useState('Studio Wend SARL');
  const [bizTagline,  setBizTagline]  = useState('Agence digitale & développement web');
  const [bizAddr,     setBizAddr]     = useState('Secteur 15, Ouagadougou\nBurkina Faso');
  const [bizCountry,  setBizCountry]  = useState('Burkina Faso');
  const [bizIfu,      setBizIfu]      = useState('00076214 B');
  const [bizRccm,     setBizRccm]     = useState('BF-OUA-2023-B-0912');
  const [bizPhone,    setBizPhone]    = useState('+226 70 12 34 56');
  const [bizEmail,    setBizEmail]    = useState('hello@studiowend.bf');
  const [bizDivision, setBizDivision] = useState('Centre des Impôts de Ouaga II');
  const [bizRegime,   setBizRegime]   = useState('RSI');

  const [cliName,     setCliName]     = useState('Sahel Banque');
  const [cliAddr,     setCliAddr]     = useState('Avenue Kwame Nkrumah\nOuagadougou, Burkina Faso');
  const [cliCountry,  setCliCountry]  = useState('Burkina Faso');
  const [cliIfu,      setCliIfu]      = useState('00031902 K');
  const [cliRccm,     setCliRccm]     = useState('BF-OUA-2009-B-0233');
  const [cliPhone,    setCliPhone]    = useState('+226 25 30 60 00');
  const [cliEmail,    setCliEmail]    = useState('compta@sahelbanque.bf');
  const [cliDivision, setCliDivision] = useState('Direction des Grandes Entreprises');
  const [cliRegime,   setCliRegime]   = useState('RNI');

  const [invNum,       setInvNum]       = useState('');
  const [invNumLocked, setInvNumLocked] = useState(false);
  const [invDate,      setInvDate]      = useState(t0);
  const [invDue,       setInvDue]       = useState(addDays(t0, 14));
  const [invTerms,     setInvTerms]     = useState('Paiement à 14 jours');
  const [invNotes,     setInvNotes]     = useState('Merci pour votre confiance.\nOrange Money / Wave : +226 70 12 34 56');
  const [invTermsCond, setInvTermsCond] = useState('');

  const [currency, setCurrency] = useState<Currency>('XOF');
  const [tvaOn,    setTvaOn]    = useState(true);
  const [tvaRate,  setTvaRate]  = useState(18);
  const [template, setTemplate] = useState<Template>('classique');

  const [items, setItems] = useState<LineItem[]>([
    { id: 1, desc: 'Développement site web', qty: '1', price: '650000' },
    { id: 2, desc: 'Hébergement annuel',     qty: '1', price: '120000' },
  ]);

  const [logoData, setLogoData] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);

  /* ── Persist to localStorage ────────────────── */
  const state = { bizName, bizTagline, bizAddr, bizCountry, bizIfu, bizRccm, bizPhone, bizEmail, bizDivision, bizRegime, cliName, cliAddr, cliCountry, cliIfu, cliRccm, cliPhone, cliEmail, cliDivision, cliRegime, invNum, invNumLocked, invDate, invDue, invTerms, invNotes, invTermsCond, currency, tvaOn, tvaRate, template, items, logoData };

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
  });

  useEffect(() => {
    let hasLockedNum = false;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.bizName)     setBizName(d.bizName);
        if (d.bizTagline)  setBizTagline(d.bizTagline);
        if (d.bizAddr)     setBizAddr(d.bizAddr);
        if (d.bizCountry)  setBizCountry(d.bizCountry);
        if (d.bizIfu)      setBizIfu(d.bizIfu);
        if (d.bizRccm)     setBizRccm(d.bizRccm);
        if (d.bizPhone)    setBizPhone(d.bizPhone);
        if (d.bizEmail)    setBizEmail(d.bizEmail);
        if (d.bizDivision) setBizDivision(d.bizDivision);
        if (d.bizRegime)   setBizRegime(d.bizRegime);
        if (d.cliName)     setCliName(d.cliName);
        if (d.cliAddr)     setCliAddr(d.cliAddr);
        if (d.cliCountry)  setCliCountry(d.cliCountry);
        if (d.cliIfu)      setCliIfu(d.cliIfu);
        if (d.cliRccm)     setCliRccm(d.cliRccm);
        if (d.cliPhone)    setCliPhone(d.cliPhone);
        if (d.cliEmail)    setCliEmail(d.cliEmail);
        if (d.cliDivision) setCliDivision(d.cliDivision);
        if (d.cliRegime)   setCliRegime(d.cliRegime);
        if (d.invDate)     setInvDate(d.invDate);
        if (d.invDue)      setInvDue(d.invDue);
        if (d.invTerms)    setInvTerms(d.invTerms);
        if (d.invNotes)     setInvNotes(d.invNotes);
        if (d.invTermsCond) setInvTermsCond(d.invTermsCond);
        if (d.currency)    setCurrency(d.currency);
        if (typeof d.tvaOn === 'boolean') setTvaOn(d.tvaOn);
        if (d.tvaRate)     setTvaRate(d.tvaRate);
        if (d.template)    setTemplate(d.template);
        if (Array.isArray(d.items) && d.items.length) setItems(d.items);
        if (d.logoData)    setLogoData(d.logoData);
        if (d.invNumLocked && d.invNum) {
          setInvNum(d.invNum);
          setInvNumLocked(true);
          hasLockedNum = true;
        }
      }
    } catch {}
    if (!hasLockedNum) {
      setInvNum(nextLocalInvNum());
      setInvNumLocked(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Calculations ───────────────────────────── */
  const { subtotal, tva, total, fmt, money } = useMemo(() => {
    const { dec, suffix } = CUR_CONFIG[currency];
    const fmtN = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const moneyN = (n: number) => `${fmtN(n)} ${suffix}`;
    const sub = items.reduce((acc, it) => acc + toNum(it.qty) * toNum(it.price), 0);
    const t = tvaOn ? sub * tvaRate / 100 : 0;
    return { subtotal: sub, tva: t, total: sub + t, fmt: fmtN, money: moneyN };
  }, [items, currency, tvaOn, tvaRate]);

  /* ── Line item helpers ──────────────────────── */
  function updateItem(id: number, field: keyof LineItem, val: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it));
  }
  function removeItem(id: number) {
    setItems(prev => prev.length > 1 ? prev.filter(it => it.id !== id) : prev);
  }
  function addItem() {
    setItems(prev => [...prev, { id: ++nextId, desc: '', qty: '1', price: '' }]);
  }

  function newInvoice() {
    const t = today();
    setInvNum(nextLocalInvNum());
    setInvNumLocked(true);
    setInvDate(t);
    setInvDue(addDays(t, 14));
    setInvTerms('Paiement à 14 jours');
    setInvNotes('');
    setInvTermsCond('');
    setCliName('');
    setCliAddr('');
    setCliIfu('');
    setCliRccm('');
    setCliPhone('');
    setCliEmail('');
    setCliDivision('');
    setCliRegime('');
    setItems([{ id: ++nextId, desc: '', qty: '1', price: '' }]);
  }

  /* ── Logo ───────────────────────────────────── */
  function handleLogoFile(file: File | null | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => setLogoData(e.target?.result as string ?? null);
    reader.readAsDataURL(file);
  }

  /* ── Print / PDF ────────────────────────────── */
  useEffect(() => {
    let triggered = false;
    const onBefore = () => { triggered = true; };
    const onAfter  = () => { if (triggered) { triggered = false; setTimeout(() => setShowModal(true), 350); } };
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint',  onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint',  onAfter);
    };
  }, []);

  /* ── Render ─────────────────────────────────── */
  return (
    <div className="ig">
      <Nav />
      <div className="ig-main">

        {/* ── Hero ── */}
        <section className="ig-hero">
          <div className="ig-wrap ig-hero-in">
            <div>
              <span className="ig-eyebrow"><i className="ti ti-receipt" /> Outil gratuit</span>
              <h1>Générateur de <span className="hl">factures gratuit.</span></h1>
              <p>Créez une facture professionnelle et conforme — TVA, IFU, RCCM — en moins d'une minute. Cliquez n'importe où pour modifier, puis téléchargez en PDF.</p>
            </div>
            <div className="ig-trust">
              <span><i className="ti ti-circle-check-filled" /> 100 % gratuit</span>
              <span><i className="ti ti-circle-check-filled" /> Sans inscription</span>
              <span><i className="ti ti-circle-check-filled" /> PDF prêt à envoyer</span>
            </div>
          </div>
        </section>

        <div className="ig-wrap ig-layout">

          {/* ── Toolbar ── */}
          <div className="ig-bar">
            <span className="ig-bar-hint">
              <i className="ti ti-click" /> Modifiable — cliquez sur n'importe quel champ
            </span>
            <div className="ig-bar-right">
              <label className="ig-cur" htmlFor={`${uid}-cur`}>
                <span>Devise</span>
                <select id={`${uid}-cur`} value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
                  <option value="FCFA">XOF</option>
                  <option value="FCFA">XAF</option>
                  <option value="GNF">GNF</option>
                  <option value="CDF">CDF</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <button className="ig-btn ig-btn--ghost" onClick={newInvoice}>
                <i className="ti ti-plus" /> Nouvelle facture
              </button>
              <button className="ig-btn ig-btn--ghost" onClick={() => window.print()}>
                <i className="ti ti-printer" /> Imprimer
              </button>
              <button className="ig-btn ig-btn--primary" onClick={() => window.print()}>
                <i className="ti ti-download" /> Télécharger en PDF
              </button>
            </div>
          </div>

          <div className="ig-grid">

            {/* ── Invoice document ── */}
            <div>
              <div className="inv-wrap">
                <div className="inv" data-tpl={template}>

                  {/* Header */}
                  <div className="inv-top">
                    <div className="inv-brand">
                      {/* Logo zone */}
                      <div
                        className="inv-logo-zone"
                        role="button"
                        tabIndex={0}
                        title="Ajouter votre logo"
                        onClick={() => logoInputRef.current?.click()}
                        onKeyDown={e => e.key === 'Enter' && logoInputRef.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); handleLogoFile(e.dataTransfer.files[0]); }}
                      >
                        {logoData
                          ? <img src={logoData} alt="Logo" />
                          : <span>{initials(bizName)}</span>
                        }
                        <span className="logo-hint"><i className="ti ti-camera" /></span>
                      </div>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={e => handleLogoFile(e.target.files?.[0])}
                      />
                      {logoData && (
                        <button
                          type="button"
                          className="logo-remove"
                          title="Retirer le logo"
                          onClick={() => { setLogoData(null); if (logoInputRef.current) logoInputRef.current.value = ''; }}
                        >
                          <i className="ti ti-x" />
                        </button>
                      )}

                      <div className="inv-biz">
                        <input type="text" className="inv-ed biz-name" placeholder="Nom de l'entreprise" value={bizName} onChange={e => setBizName(e.target.value)} />
                        <input type="text" className="inv-ed biz-tagline" placeholder="Slogan ou activité" value={bizTagline} onChange={e => setBizTagline(e.target.value)} />
                      </div>
                    </div>

                    <div className="inv-doc">
                      <div className="inv-doctitle">FACTURE</div>
                      <div className="inv-docnum">
                        N°&nbsp;
                        <span className="docnum-locked" title="Numéro attribué automatiquement — conforme DGI">{invNum}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bill from | Bill to — side by side */}
                  <div className="inv-parties">
                    <div className="inv-party">
                      <div className="im-l">De</div>
                      <input type="text" className="inv-ed cli-name" placeholder="Nom de l'entreprise" value={bizName} onChange={e => setBizName(e.target.value)} />
                      <AutoTextarea className="cli-addr" placeholder="Adresse" value={bizAddr} onChange={e => setBizAddr(e.target.value)} />
                      <div className="biz-line">
                        <span className="k">Pays</span>
                        <select className="inv-ed inv-mini" value={bizCountry} onChange={e => setBizCountry(e.target.value)}>
                          {OHADA_COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="biz-line">
                        <span className="k">{getFiscalIdLabel(bizCountry)}</span>
                        <input type="text" className="inv-ed inv-mini" placeholder={getFiscalIdPlaceholder(bizCountry)} value={bizIfu} onChange={e => setBizIfu(e.target.value)} />
                        <span className="dot">·</span>
                        <span className="k">RCCM</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="BF-OUA-…" value={bizRccm} onChange={e => setBizRccm(e.target.value)} />
                      </div>
                      <div className="biz-line">
                        <input type="text" className="inv-ed inv-mini" placeholder="Téléphone" value={bizPhone} onChange={e => setBizPhone(e.target.value)} />
                        <span className="dot">·</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="Email" value={bizEmail} onChange={e => setBizEmail(e.target.value)} />
                      </div>
                      <div className="biz-line">
                        <span className="k">Division fiscale</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="Centre des Impôts…" value={bizDivision} onChange={e => setBizDivision(e.target.value)} />
                        <span className="dot">·</span>
                        <span className="k">Régime</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="RSI, RNI, CME…" value={bizRegime} onChange={e => setBizRegime(e.target.value)} />
                      </div>
                    </div>

                    <div className="inv-party">
                      <div className="im-l">Facturé à</div>
                      <input type="text" className="inv-ed cli-name" placeholder="Nom du client" value={cliName} onChange={e => setCliName(e.target.value)} />
                      <AutoTextarea className="cli-addr" placeholder="Adresse" value={cliAddr} onChange={e => setCliAddr(e.target.value)} />
                      <div className="biz-line">
                        <span className="k">Pays</span>
                        <select className="inv-ed inv-mini" value={cliCountry} onChange={e => setCliCountry(e.target.value)}>
                          {OHADA_COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="biz-line">
                        <span className="k">{getFiscalIdLabel(cliCountry)}</span>
                        <input type="text" className="inv-ed inv-mini" placeholder={getFiscalIdPlaceholder(cliCountry)} value={cliIfu} onChange={e => setCliIfu(e.target.value)} />
                        <span className="dot">·</span>
                        <span className="k">RCCM</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="BF-OUA-…" value={cliRccm} onChange={e => setCliRccm(e.target.value)} />
                      </div>
                      <div className="biz-line">
                        <input type="text" className="inv-ed inv-mini" placeholder="Téléphone" value={cliPhone} onChange={e => setCliPhone(e.target.value)} />
                        <span className="dot">·</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="Email" value={cliEmail} onChange={e => setCliEmail(e.target.value)} />
                      </div>
                      <div className="biz-line">
                        <span className="k">Division fiscale</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="Direction…" value={cliDivision} onChange={e => setCliDivision(e.target.value)} />
                        <span className="dot">·</span>
                        <span className="k">Régime</span>
                        <input type="text" className="inv-ed inv-mini" placeholder="RSI, RNI, CME…" value={cliRegime} onChange={e => setCliRegime(e.target.value)} />
                      </div>
                    </div>
                  </div>

                  {/* Meta strip */}
                  <div className="inv-meta">
                    <div className="meta-cell">
                      <span className="meta-k">Date d'émission</span>
                      <div className="date-wrap">
                        <b className="meta-v">{fmtDate(invDate)}</b>
                        <input type="date" className="date-input" aria-label="Date d'émission" value={invDate} onChange={e => setInvDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="meta-cell">
                      <span className="meta-k">Date d'échéance</span>
                      <div className="date-wrap">
                        <b className="meta-v">{fmtDate(invDue)}</b>
                        <input type="date" className="date-input" aria-label="Date d'échéance" value={invDue} onChange={e => setInvDue(e.target.value)} />
                      </div>
                    </div>
                    <div className="meta-cell">
                      <span className="meta-k">Conditions de paiement</span>
                      <input type="text" className="inv-ed meta-terms" placeholder="Paiement à 14 jours" value={invTerms} onChange={e => setInvTerms(e.target.value)} />
                    </div>
                  </div>

                  {/* Line items */}
                  <table className="inv-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="r">Qté</th>
                        <th className="r">Prix unitaire</th>
                        <th className="r">Montant</th>
                        <th className="th-x" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => {
                        const amt = toNum(it.qty) * toNum(it.price);
                        return (
                          <tr key={it.id} className="li-row">
                            <td className="li-desc-c">
                              <input className="li-desc" placeholder="Description de la prestation" value={it.desc} onChange={e => updateItem(it.id, 'desc', e.target.value)} />
                            </td>
                            <td className="li-qty-c">
                              <input className="li-qty" inputMode="decimal" placeholder="1" value={it.qty} onChange={e => updateItem(it.id, 'qty', e.target.value)} />
                            </td>
                            <td className="li-price-c">
                              <input className="li-price" inputMode="decimal" placeholder="0" value={it.price} onChange={e => updateItem(it.id, 'price', e.target.value)} />
                            </td>
                            <td className="li-amt">{fmt(amt)}</td>
                            <td className="li-x-c">
                              <button type="button" className="li-del" title="Supprimer" onClick={() => removeItem(it.id)}>
                                <i className="ti ti-x" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button type="button" className="ln-add" onClick={addItem}>
                    <i className="ti ti-plus" /> Ajouter une ligne
                  </button>

                  {/* Totals + notes */}
                  <div className="inv-bottom">
                    <div className="inv-notes">
                      <div className="nt">Notes</div>
                      <AutoTextarea className="notes-in" placeholder="Merci pour votre confiance…" value={invNotes} onChange={e => setInvNotes(e.target.value)} />
                      <div className="nt" style={{ marginTop: 12 }}>Conditions générales</div>
                      <AutoTextarea className="notes-in" placeholder="Ex : Tout retard de paiement entraîne des pénalités de 1,5 % par mois…" value={invTermsCond} onChange={e => setInvTermsCond(e.target.value)} />
                    </div>
                    <div className="inv-tot">
                      <div className="tt-row">
                        <span>Sous-total</span>
                        <span>{money(subtotal)}</span>
                      </div>
                      <div className={`tt-row tva-row${tvaOn ? '' : ' off'}`}>
                        <span className="tva-ctl">
                          <label className="mini-switch" title="Appliquer la TVA">
                            <input type="checkbox" checked={tvaOn} onChange={e => setTvaOn(e.target.checked)} />
                            <span className="ms-track" />
                          </label>
                          TVA
                          <input
                            type="number"
                            className="inv-ed tva-rate-in"
                            value={tvaRate}
                            min={0} max={100} step={0.5}
                            disabled={!tvaOn}
                            onChange={e => setTvaRate(Number(e.target.value))}
                          />
                          %
                        </span>
                        <span>{money(tva)}</span>
                      </div>
                      <div className="tt-row grand">
                        <span>Total dû</span>
                        <span>{money(total)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Invoice foot */}
                  <div className="inv-foot">
                    <div className="inv-credit">
                      <div className="inv-credit-main">
                        <span className="bmark"><BillioMark size={11} /></span>
                        Facture créée avec Billio
                      </div>
                      <div className="inv-credit-sub">
                        Visitez billio.app pour créer des factures professionnelles gratuitement.
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* ── Right rail ── */}
            <aside className="ig-rail">
              <div className="tpl-card">
                <div className="tpl-h"><i className="ti ti-template" /> Modèle de facture</div>
                <div className="tpl-opts">
                  {(['classique', 'bandeau', 'epure', 'moderne', 'encadre'] as Template[]).map(tpl => (
                    <button
                      key={tpl}
                      type="button"
                      className={`tpl-opt${template === tpl ? ' active' : ''}`}
                      data-tpl={tpl}
                      onClick={() => setTemplate(tpl)}
                    >
                      <span className="tpl-thumb">
                        <span className="th-head"><span className="th-logo" /><span className="th-title" /></span>
                        <span className="th-rows"><i /><i /><i /></span>
                      </span>
                      {tpl.charAt(0).toUpperCase() + tpl.slice(1).replace('e', 'é')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ig-upsell">
                <div className="ig-upsell-in">
                  <span className="ig-uk"><i className="ti ti-sparkles" /> Passez en pilote automatique</span>
                  <h3>Cette facture, mais vivante.</h3>
                  <ul>
                    <li><i className="ti ti-send" /> Envoyez par WhatsApp ou email</li>
                    <li><i className="ti ti-robot" /> Relances automatiques</li>
                    <li><i className="ti ti-shield-check" /> Encaissement comptabilisé</li>
                  </ul>
                  <Link to="/login" className="ig-btn ig-btn--white" style={{ width: '100%', marginTop: 18 }}>
                    Créer mon compte gratuit <i className="ti ti-arrow-right" />
                  </Link>
                </div>
              </div>
            </aside>

          </div>
        </div>

        {/* ── Footer band ── */}
        <section className="ig-foot">
          <div className="ig-wrap">
            <h2>Facturer, c'est gratuit. Rester en règle, c'est Billio.</h2>
            <p>Gardez ce générateur autant que vous voulez. Quand vous serez prêt à suivre vos paiements et tenir une compta conforme sans effort, Billio prend le relais.</p>
            <div className="ig-foot-btns">
              <Link to="/login" className="ig-btn ig-btn--white ig-btn--lg">
                Commencer gratuitement <i className="ti ti-arrow-right" />
              </Link>
              <Link to="/#tarifs" className="ig-btn ig-btn--light ig-btn--lg">
                <i className="ti ti-tag" /> Voir les tarifs
              </Link>
            </div>
            <div className="ig-foot-trust">
              <span><i className="ti ti-circle-check-filled" /> Sans carte bancaire</span>
              <span><i className="ti ti-circle-check-filled" /> Conforme SYSCOHADA</span>
              <span><i className="ti ti-circle-check-filled" /> Prêt en 2 minutes</span>
            </div>
          </div>
        </section>

      </div>

      {/* ── Post-print modal ── */}
      {showModal && (
        <div
          className="ig-scrim open"
          role="dialog"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="ig-modal">
            <div className="ig-modal-ico"><i className="ti ti-circle-check-filled" /></div>
            <h3>Votre facture est prête.</h3>
            <p>Avec Billio, vous l'envoyez en un clic, suivez le paiement et votre comptabilité se met à jour toute seule — prête pour la DGI.</p>
            <div className="ig-modal-cta">
              <Link to="/login" className="ig-btn ig-btn--primary ig-btn--lg" style={{ justifyContent: 'center' }}>
                Suivre cette facture avec Billio <i className="ti ti-arrow-right" />
              </Link>
              <button type="button" className="ig-modal-dismiss" onClick={() => setShowModal(false)}>
                Continuer sans compte
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
