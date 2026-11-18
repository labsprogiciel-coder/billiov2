import { useCallback, useEffect, useMemo, useState } from 'react';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import InvoicePaper from '@/components/InvoicePaper';
import type { PaperConfig, PaperLayout, PaperDensity, TableStyle, TotalStyle } from '@/components/InvoicePaper';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { BAND_COLORS, BANDED_LAYOUTS, DEFAULT_CONFIG, FONT_FAMILIES, PRESETS, normalizeConfig } from '@/lib/invoice-template';
import { useBlocker } from 'react-router-dom';
import { createTemplate, fetchTemplates, setDefaultTemplate, updateTemplate, type SavedTemplate } from '@/lib/api/invoice-templates';
import { fetchPaymentSettings } from '@/lib/api/payment-settings';
import { paymentMethodLines, type PaymentMethodLine } from '@/lib/payment-methods';
import Page from '@/components/Page';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACCENT_COLORS = [
  { label: 'Bleu',    hex: '#185FA5' },
  { label: 'Vert',    hex: '#1A7A47' },
  { label: 'Violet',  hex: '#5B2D8E' },
  { label: 'Orange',  hex: '#C4540A' },
  { label: 'Ardoise', hex: '#334155' },
  { label: 'Teal',    hex: '#0D7B7B' },
  { label: 'Rose',    hex: '#9B2460' },
  { label: 'Brique',  hex: '#7C2D12' },
];

const FONTS: { label: string; desc: string; family: string; sample: string }[] = [
  { label: 'Jakarta Sans', desc: 'Sans-serif moderne',          family: FONT_FAMILIES.jakarta, sample: 'Aa' },
  { label: 'Space Grotesk',desc: 'Géométrique technique',       family: FONT_FAMILIES.grotesk, sample: 'Aa' },
  { label: 'Lora',         desc: 'Serif élégant',               family: FONT_FAMILIES.lora,    sample: 'Aa' },
  { label: 'IBM Plex Mono',desc: 'Monospace professionnel',     family: FONT_FAMILIES.plex,    sample: 'Aa' },
];

const LAYOUTS: { key: PaperLayout; label: string }[] = [
  { key: 'classic', label: 'Classique' },
  { key: 'band',    label: 'Bandeau' },
  { key: 'minimal', label: 'Minimal' },
  { key: 'sidebar', label: 'Colonne' },
  { key: 'receipt', label: 'Reçu' },
];

// ---------------------------------------------------------------------------
// Template shown in the gallery: a saved one (invoice_templates) or a
// built-in preset the organisation hasn't saved yet
// ---------------------------------------------------------------------------
interface Template {
  /** invoice_templates.id, or `preset:<key>` for an unsaved preset */
  id:        string;
  presetKey: string | null;
  saved:     boolean;
  name:      string;
  purpose:   string;
  chips:     string[];
  isDefault: boolean;
  starred:   boolean;
  config:    PaperConfig;
}

const PRESET_ID = (key: string) => `preset:${key}`;
/** invoice_templates.name is limited to 80 characters */
const NAME_MAX = 80;
/** The name as it is saved: trimmed, at most NAME_MAX, « Nouveau modèle » when empty */
const savedName = (name: string) => name.trim().slice(0, NAME_MAX).trim() || 'Nouveau modèle';

function galleryTemplates(saved: SavedTemplate[]): Template[] {
  const hasDefault = saved.some(t => t.isDefault);
  const presets: Template[] = PRESETS
    .filter(p => !saved.some(t => t.presetKey === p.key))
    .map(p => ({
      id: PRESET_ID(p.key), presetKey: p.key, saved: false, name: p.name, purpose: p.purpose, chips: p.chips,
      // With no saved default, invoices use the standard template: Classique Billio
      isDefault: !hasDefault && p.key === PRESETS[0].key, starred: false, config: p.config,
    }));
  const own: Template[] = saved.map(t => {
    const preset = PRESETS.find(p => p.key === t.presetKey);
    return {
      id: t.id, presetKey: t.presetKey, saved: true, name: t.name,
      purpose: preset?.purpose ?? 'Modèle personnalisé',
      chips: preset?.chips ?? [LAYOUTS.find(l => l.key === t.config.layout)?.label ?? 'Personnalisé'],
      // A saved copy of the standard template stays the one in use until another is chosen
      isDefault: t.isDefault || (!hasDefault && t.presetKey === PRESETS[0].key), starred: t.starred, config: t.config,
    };
  });
  // Presets first in their usual order, saved copies in place of their preset
  const ordered = PRESETS.map(p => own.find(t => t.presetKey === p.key) ?? presets.find(t => t.presetKey === p.key)!);
  return [...ordered, ...own.filter(t => !t.presetKey || !PRESETS.some(p => p.key === t.presetKey))];
}

// ---------------------------------------------------------------------------
// Layout mini-diagrams (SVG-like using absolute divs)
// ---------------------------------------------------------------------------
const LAYOUT_DIAGRAMS: Record<PaperLayout, React.ReactNode> = {
  classic: (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="lm acc" style={{ top: 4, left: 4, right: 4, height: 8, borderRadius: 2 }} />
      <div className="lm" style={{ top: 16, left: 4, width: '40%', height: 3 }} />
      <div className="lm" style={{ top: 21, left: 4, width: '30%', height: 3 }} />
      <div className="lm" style={{ top: 28, left: 4, right: 4, height: 2 }} />
      <div className="lm" style={{ top: 33, left: 4, width: '60%', height: 2 }} />
      <div className="lm" style={{ top: 37, left: 4, width: '50%', height: 2 }} />
    </div>
  ),
  band: (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="lm acc" style={{ top: 0, left: 0, right: 0, height: 12, borderRadius: 0 }} />
      <div className="lm" style={{ top: 16, left: 4, width: '40%', height: 3 }} />
      <div className="lm" style={{ top: 21, left: 4, right: 4, height: 2 }} />
      <div className="lm" style={{ top: 26, left: 4, width: '70%', height: 2 }} />
      <div className="lm" style={{ top: 31, left: 4, width: '50%', height: 2 }} />
      <div className="lm" style={{ top: 37, left: 4, right: 4, height: 2 }} />
    </div>
  ),
  minimal: (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="lm acc" style={{ top: 4, left: 4, width: '50%', height: 5, borderRadius: 1 }} />
      <div className="lm" style={{ top: 12, left: 4, right: 4, height: 1 }} />
      <div className="lm" style={{ top: 16, left: 4, width: '35%', height: 2 }} />
      <div className="lm" style={{ top: 20, left: 4, width: '45%', height: 2 }} />
      <div className="lm" style={{ top: 27, left: 4, right: 4, height: 2 }} />
      <div className="lm" style={{ top: 32, left: 4, width: '70%', height: 2 }} />
    </div>
  ),
  sidebar: (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="lm acc" style={{ top: 0, left: 0, width: '30%', bottom: 0, borderRadius: 0 }} />
      <div className="lm" style={{ top: 6, left: '34%', width: '40%', height: 3 }} />
      <div className="lm" style={{ top: 12, left: '34%', right: 4, height: 2 }} />
      <div className="lm" style={{ top: 17, left: '34%', width: '55%', height: 2 }} />
      <div className="lm" style={{ top: 22, left: '34%', width: '45%', height: 2 }} />
      <div className="lm" style={{ top: 30, left: '34%', right: 4, height: 2 }} />
    </div>
  ),
  receipt: (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div className="lm acc" style={{ top: 4, left: '50%', transform: 'translateX(-50%)', width: 18, height: 18, borderRadius: '50%' }} />
      <div className="lm" style={{ top: 26, left: '20%', right: '20%', height: 1 }} />
      <div className="lm" style={{ top: 31, left: 4, right: 4, height: 2 }} />
      <div className="lm" style={{ top: 36, left: 4, width: '60%', height: 2 }} />
    </div>
  ),
};

const LOCKED_SECTIONS: { label: string; badge: 'Obligatoire' | 'Si certifiée'; from: string }[] = [
  { label: 'Total en lettres',              badge: 'Obligatoire',  from: 'Calculé à partir du total' },
  { label: 'Date, heure et opérateur',      badge: 'Obligatoire',  from: 'Ajoutés à l’émission de la facture' },
  { label: 'Référence cadastrale',          badge: 'Obligatoire',  from: 'Paramètres › Entreprise' },
  { label: 'Coordonnées bancaires',         badge: 'Obligatoire',  from: 'Paramètres › Paiements' },
  { label: 'Bloc SECeF (code et QR)',       badge: 'Si certifiée', from: 'Ajouté à la certification de la facture' },
];

function LockedSections({ cfg, set }: { cfg: PaperConfig; set: <K extends keyof PaperConfig>(k: K, v: PaperConfig[K]) => void }) {
  return (
    <div className="ed-group">
      <div className="ed-group-title"><Icon name="eye" size={14} ariaHidden />Sections</div>
      <ul className="tpl-locked">
        {LOCKED_SECTIONS.map(s => (
          <li key={s.label} title={s.from}>
            <Icon name="lock" size={14} ariaHidden />
            <span className="tpl-locked-label">{s.label}<small>{s.from}</small></span>
            <span className={`tpl-lock-badge${s.badge === 'Si certifiée' ? ' muted' : ''}`}>{s.badge}</span>
          </li>
        ))}
      </ul>
      <div className="tog-row">
        <div className="row-label">Signature<small>Ligne de signature</small></div>
        <button className={`tp-toggle${cfg.showSignature ? ' on' : ''}`} onClick={() => set('showSignature', !cfg.showSignature)} aria-pressed={cfg.showSignature} aria-label="Signature" />
      </div>
      <div className="tog-row">
        <div className="row-label">
          QR code de paiement
          <small>Petit, à côté des modes de paiement. Il ouvrira la page de paiement de la facture, avec le reste dû : imprimé dès que le paiement en ligne des factures sera disponible. Jamais sur un devis, un avoir ou une facture payée.</small>
        </div>
        <button className={`tp-toggle${cfg.showPaymentQr ? ' on' : ''}`} onClick={() => set('showPaymentQr', !cfg.showPaymentQr)} aria-pressed={cfg.showPaymentQr} aria-label="QR code de paiement" />
      </div>
      <p className="tpl-locked-note">Les sections verrouillées viennent des Paramètres et de l’émission : un modèle ne peut pas les masquer.</p>
    </div>
  );
}

function EditorControls({ cfg, onChange, locked = false }: { cfg: PaperConfig; onChange: (c: PaperConfig) => void; locked?: boolean }) {
  function set<K extends keyof PaperConfig>(k: K, v: PaperConfig[K]) {
    onChange({ ...cfg, [k]: v });
  }

  // Quantities, VAT, discount and payment details always appear: they are
  // mentions an invoice must carry, so a template can't hide them
  const SEC_OPTS: { key: keyof PaperConfig; label: string; sub: string }[] = [
    { key: 'showSignature', label: 'Signature',          sub: 'Ligne de signature' },
    { key: 'showPaymentQr', label: 'QR code de paiement', sub: 'Imprimé avec le paiement en ligne des factures' },
  ];

  return (
    <div className="ed-controls">
      {/* Layout */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="layout-grid" size={14} ariaHidden />Mise en page</div>
        <div className="layout-grid">
          {LAYOUTS.map(l => (
            <button
              key={l.key}
              className={`layout-btn${cfg.layout === l.key ? ' active' : ''}`}
              onClick={() => set('layout', l.key)}
            >
              <div className="layout-mini">{LAYOUT_DIAGRAMS[l.key]}</div>
              <div className="layout-label">{l.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="palette" size={14} ariaHidden />Couleur d'accent</div>
        <div className="swatch-row">
          {ACCENT_COLORS.map(c => (
            <div
              key={c.hex}
              className={`swatch${cfg.color === c.hex ? ' active' : ''}`}
              style={{ background: c.hex, color: c.hex }}
              title={c.label}
              role="radio"
              aria-checked={cfg.color === c.hex}
              aria-label={c.label}
              tabIndex={0}
              onClick={() => set('color', c.hex)}
              onKeyDown={e => e.key === 'Enter' && set('color', c.hex)}
            />
          ))}
        </div>
      </div>

      {/* Font */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="file-text" size={14} ariaHidden />Police</div>
        <div className="font-grid">
          {FONTS.map(f => (
            <div
              key={f.family}
              className={`font-opt${cfg.fontFamily === f.family ? ' active' : ''}`}
              onClick={() => set('fontFamily', f.family)}
            >
              <div className="font-sample" style={{ fontFamily: f.family }}>{f.sample}</div>
              <div className="font-info">
                <div className="fn">{f.label}</div>
                <div className="fd">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Density */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="list" size={14} ariaHidden />Densité</div>
        <div className="dens-seg">
          {(['compact', 'cozy', 'spacious'] as PaperDensity[]).map(d => (
            <button
              key={d}
              className={`dens-opt${cfg.density === d ? ' active' : ''}`}
              onClick={() => set('density', d)}
            >
              {d === 'compact' ? 'Compact' : d === 'cozy' ? 'Normal' : 'Aéré'}
            </button>
          ))}
        </div>
      </div>

      {/* Table style */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="table" size={14} ariaHidden />Style tableau</div>
        <div className="dens-seg">
          {([['plain', 'Lignes'], ['tinted', 'Teinte'], ['band-h', 'Plein']] as [TableStyle, string][]).map(([k, lbl]) => (
            <button
              key={k}
              className={`dens-opt${cfg.tableStyle === k ? ' active' : ''}`}
              onClick={() => set('tableStyle', k)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Total style */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="cash" size={14} ariaHidden />Style total</div>
        <div className="dens-seg">
          {([['plain', 'Simple'], ['filled', 'Rempli'], ['ruled', 'Souligné']] as [TotalStyle, string][]).map(([k, lbl]) => (
            <button
              key={k}
              className={`dens-opt${cfg.totalStyle === k ? ' active' : ''}`}
              onClick={() => set('totalStyle', k)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {locked ? <LockedSections cfg={cfg} set={set} /> : <div className="ed-group">
        <div className="ed-group-title"><Icon name="eye" size={14} ariaHidden />Sections</div>
        {SEC_OPTS.map(o => (
          <div key={o.key} className="tog-row">
            <div className="row-label">
              {o.label}
              <small>{o.sub}</small>
            </div>
            <button
              className={`tp-toggle${cfg[o.key] ? ' on' : ''}`}
              onClick={() => set(o.key as keyof PaperConfig, !cfg[o.key] as PaperConfig[typeof o.key])}
              aria-pressed={!!cfg[o.key]}
              aria-label={o.label}
            />
          </div>
        ))}
      </div>}

      {/* Header and footer bands (Classique, Minimal) */}
      {BANDED_LAYOUTS.includes(cfg.layout) && (
        <div className="ed-group">
          <div className="ed-group-title"><Icon name="layout-grid" size={14} ariaHidden />En-tête et pied de page</div>
          <div className="tog-row">
            <div className="row-label">
              En bandeau
              <small>Fond teinté sur toute la largeur, en haut et en bas de page</small>
            </div>
            <button
              className={`tp-toggle${cfg.bands ? ' on' : ''}`}
              onClick={() => set('bands', !cfg.bands)}
              aria-pressed={cfg.bands}
              aria-label="En-tête et pied de page en bandeau"
            />
          </div>
          {cfg.bands && (
            <div className="swatch-row" role="radiogroup" aria-label="Teinte du bandeau" style={{ marginTop: 10 }}>
              {BAND_COLORS.map(c => (
                <button
                  type="button"
                  key={c.value}
                  role="radio"
                  aria-checked={cfg.bandColor === c.value}
                  aria-label={c.label}
                  title={c.label}
                  className={`swatch band-swatch${cfg.bandColor === c.value ? ' active' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => set('bandColor', c.value)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="ed-group">
        <div className="ed-group-title"><Icon name="info-circle" size={14} ariaHidden />Pied de page</div>
        <textarea
          className="ed-textarea"
          rows={3}
          placeholder="Facture générée via Billio"
          maxLength={200}
          value={cfg.footer}
          onChange={e => set('footer', e.target.value)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
type View = 'gallery' | { kind: 'editor'; id: string };

export default function TemplatesPage() {
  const { orgSettings, orgId, loading, showToast, setInvoiceTemplate } = useApp();
  const { managesOrg } = usePermissions();
  const [saved, setSaved] = useState<SavedTemplate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [payLines, setPayLines] = useState<PaymentMethodLine[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('gallery');
  const [zoom, setZoom] = useState(100);

  // Editor state — editing a copy of the template's config
  const [edConfig, setEdConfig] = useState<PaperConfig>(DEFAULT_CONFIG);
  const [edName, setEdName] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setSaved(await fetchTemplates(orgId));
      setLoadError(false);
    } catch (err) {
      console.error('[templates] load failed:', err);
      setLoadError(true);
      setSaved([]);
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!orgId) return;
    // Preview with the organisation's payment methods; not fatal if unavailable
    fetchPaymentSettings(orgId).then(s => setPayLines(paymentMethodLines(s))).catch(() => setPayLines([]));
  }, [orgId]);

  const templates = useMemo(() => galleryTemplates(saved ?? []), [saved]);

  // New interface (PRO-171): no gallery, the template in use opens straight away
  const editingId = view === 'gallery' ? null : view.id;
  const defaultId = templates.find(t => t.isDefault)?.id ?? templates[0]?.id;
  useEffect(() => {
    if (saved !== null && view === 'gallery' && defaultId) openEditor(defaultId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once the list is there
  }, [saved, defaultId, view]);

  const editedTpl = editingId && editingId !== 'new' ? templates.find(t => t.id === editingId) : null;
  const dirty = editingId !== null && (
    editingId === 'new' || !editedTpl
      ? true
      : savedName(edName) !== editedTpl.name || JSON.stringify(normalizeConfig(edConfig)) !== JSON.stringify(normalizeConfig(editedTpl.config))
  );
  // Leaving with unsaved changes asks first, as in the invoice editor
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && managesOrg && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Ce modèle a des modifications non enregistrées. Quitter sans enregistrer ?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  if (loading || saved === null) return <PageSkeleton title="Modèles de facture" subtitle="Choisissez un design prêt à l'emploi ou créez le vôtre" variant="table-only" rows={4} />;

  function openEditor(id: string) {
    const tpl = id === 'new'
      ? { id: 'new', name: 'Nouveau modèle', config: DEFAULT_CONFIG }
      : templates.find(t => t.id === id)!;
    setEdConfig({ ...tpl.config });
    setEdName(tpl.name);
    setView({ kind: 'editor', id });
    setZoom(100);
  }

  function resetEditor() {
    if (view === 'gallery') return;
    const id = view.id;
    if (id === 'new') {
      setEdConfig(DEFAULT_CONFIG);
      setEdName('Nouveau modèle');
    } else {
      const tpl = templates.find(t => t.id === id);
      if (tpl) { setEdConfig({ ...tpl.config }); setEdName(tpl.name); }
    }
  }

  /** The saved row for a gallery template, creating it from its preset if needed. */
  async function ensureSaved(tpl: Template, patch?: { name?: string; config?: PaperConfig; starred?: boolean }): Promise<SavedTemplate> {
    if (tpl.saved) {
      if (!patch) return saved!.find(t => t.id === tpl.id)!;
      return updateTemplate(orgId, tpl.id, patch);
    }
    return createTemplate(orgId, {
      presetKey: tpl.presetKey, name: patch?.name ?? tpl.name, config: patch?.config ?? tpl.config, starred: patch?.starred ?? tpl.starred,
    });
  }

  async function run(action: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      console.error('[templates]', err);
      showToast(failure, true);
    } finally {
      setBusy(false);
      void load();
    }
  }

  function saveTemplate() {
    if (view === 'gallery') return;
    const { id } = view;
    const name = savedName(edName);
    const config = { ...edConfig };
    void run(async () => {
      if (id === 'new') {
        const row = await createTemplate(orgId, { name, config });
        setView({ kind: 'editor', id: row.id });
      } else {
        const tpl = templates.find(t => t.id === id)!;
        const row = await ensureSaved(tpl, { name, config });
        setView({ kind: 'editor', id: row.id });
        // Editing the template in use changes the next PDFs straight away.
        // The standard template is only implicitly in use: save it as the
        // default, or PDFs would fall back to the unedited one after a reload.
        if (tpl.isDefault) {
          if (!row.isDefault) await setDefaultTemplate(orgId, row.id);
          setInvoiceTemplate(config);
        }
      }
      showToast('Modèle enregistré');
    }, "Le modèle n'a pas pu être enregistré. Réessayez.");
  }

  function applyTemplate(id: string) {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    void run(async () => {
      const row = await ensureSaved(tpl);
      // A preset saved here gets a row of its own: the editor follows it
      if (editorId === tpl.id && row.id !== tpl.id) setView({ kind: 'editor', id: row.id });
      await setDefaultTemplate(orgId, row.id);
      setInvoiceTemplate(row.config);
      posthog.capture('template_changed', { template_name: row.name, layout: row.config.layout });
      showToast(`« ${row.name} » sera utilisé pour vos factures et devis`);
    }, "Le modèle n'a pas pu être appliqué. Réessayez.");
  }

  function zoomStep(dir: 1 | -1) {
    setZoom(z => Math.min(150, Math.max(50, z + dir * 10)));
  }

  const editorId = view !== 'gallery' ? view.id : null;
  const editorTpl = editorId && editorId !== 'new' ? templates.find(t => t.id === editorId) : null;

  /** Another template, or a new one: unsaved changes are confirmed first. */
  function select(id: string) {
    // Not while a template is being saved: its completion selects it again
    if (id === editorId || busy) return;
    if (dirty && managesOrg && !window.confirm('Ce modèle a des modifications non enregistrées. Les abandonner ?')) return;
    openEditor(id);
  }

  return (
    <Page
      title="Modèles de facture"
      subtitle="Le modèle par défaut s’applique aux PDF de vos factures, avoirs et devis."
      actions={managesOrg && (
        <button className="btn" onClick={() => select('new')} disabled={busy}>
          <Icon name="plus" size={16} ariaHidden />
          Nouveau modèle
        </button>
      )}
    >
      {loadError && <div className="gi-sub" role="alert" style={{ marginBottom: 12, color: 'var(--color-danger, #B42318)' }}>Vos modèles enregistrés n'ont pas pu être chargés. <button className="btn btn-sm" onClick={() => void load()}>Réessayer</button></div>}
      <div className={`tpl-ws${managesOrg ? '' : ' readonly'}`}>
        <nav className="tpl-ws-list" aria-label="Modèles">
          {editorId === 'new' && (
            <button type="button" className="tpl-ws-item active" aria-current="true">
              <span className="tpl-ws-name">{edName || 'Nouveau modèle'}</span>
              <small>Pas encore enregistré</small>
            </button>
          )}
          {templates.map(t => (
            <button type="button" key={t.id} className={`tpl-ws-item${t.id === editorId ? ' active' : ''}`} aria-current={t.id === editorId ? 'true' : undefined} onClick={() => select(t.id)} disabled={busy && t.id !== editorId}>
              <span className="tpl-ws-name">{t.name}</span>
              <small>{t.isDefault ? 'Par défaut · factures, avoirs et devis' : t.purpose}</small>
            </button>
          ))}
          {!managesOrg && <p className="tpl-ws-note">Seuls les administrateurs peuvent modifier les modèles.</p>}
        </nav>

        <section className="tpl-ws-preview" aria-label="Aperçu A4">
          <div className="ed-preview-bar">
            <span style={{ flex: 1, textAlign: 'left' }}>Aperçu en direct · facture d’exemple</span>
            <button className="zoom-btn" onClick={() => zoomStep(-1)} aria-label="Zoom arrière">−</button>
            <span className="zoom-val">{zoom}%</span>
            <button className="zoom-btn" onClick={() => zoomStep(1)} aria-label="Zoom avant">+</button>
          </div>
          <div className="ed-stage">
            <div className="ed-paper-shadow" style={{ transformOrigin: 'top center', transform: `scale(${zoom / 100})`, transition: 'transform .15s', display: 'inline-block' }}>
              <InvoicePaper config={edConfig} biz={orgSettings} paymentMethods={payLines} paymentTerms={orgSettings.paymentTerms} />
            </div>
          </div>
        </section>

        {managesOrg && (
          <aside className="tpl-ws-side" aria-label="Réglages du modèle">
            <label className="tpl-ws-field">
              <span>Nom du modèle</span>
              <input className="form-input" value={edName} onChange={e => setEdName(e.target.value)} maxLength={NAME_MAX} spellCheck={false} />
            </label>
            <EditorControls cfg={edConfig} onChange={setEdConfig} locked />
            <div className="tpl-ws-actions">
              {editorTpl && !editorTpl.isDefault && (
                <button className="btn" onClick={() => applyTemplate(editorTpl.id)} disabled={busy || dirty} title={dirty ? 'Enregistrez d’abord vos modifications' : undefined}>
                  Définir par défaut
                </button>
              )}
              {dirty && editorId !== 'new' && <button className="btn" onClick={resetEditor} disabled={busy}>Annuler les modifications</button>}
              <button className="btn btn-primary" onClick={saveTemplate} disabled={busy || !dirty}>
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </aside>
        )}
      </div>
    </Page>
  );
}
