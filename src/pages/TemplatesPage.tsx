import { useCallback, useEffect, useMemo, useState } from 'react';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import { EmptyState } from '@/components/EmptyState';
import { TemplatesEmptyIllustration } from '@/components/PageEmptyIllustrations';
import InvoicePaper from '@/components/InvoicePaper';
import type { PaperConfig, PaperLayout, PaperDensity, TableStyle, TotalStyle, BizInfo } from '@/components/InvoicePaper';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { usePermissions } from '@/lib/use-permissions';
import { DEFAULT_CONFIG, FONT_FAMILIES, PRESETS } from '@/lib/invoice-template';
import { createTemplate, fetchTemplates, setDefaultTemplate, updateTemplate, type SavedTemplate } from '@/lib/api/invoice-templates';
import { fetchPaymentSettings } from '@/lib/api/payment-settings';
import { paymentMethodLines, type PaymentMethodLine } from '@/lib/payment-methods';

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
      isDefault: t.isDefault, starred: t.starred, config: t.config,
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

// ---------------------------------------------------------------------------
// Thumbnail scale helper
// ---------------------------------------------------------------------------
function thumbScale(layout: PaperLayout) {
  return layout === 'receipt' ? 0.57 : 0.37;
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------
function TemplateCard({
  tpl, biz, payLines, paymentTerms, canEdit, busy, onEdit, onUse, onToggleStar,
}: {
  tpl: Template;
  biz: BizInfo;
  payLines?: PaymentMethodLine[];
  paymentTerms: string;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onUse: () => void;
  onToggleStar: () => void;
}) {
  const scale = thumbScale(tpl.config.layout);
  const paperWidth = tpl.config.layout === 'receipt' ? 462 : 720;
  const scaledW = paperWidth * scale;
  const offsetX = tpl.config.layout === 'receipt' ? Math.max(0, (264 - scaledW) / 2) : 0;

  return (
    <div className="tpl-card">
      {/* Thumbnail */}
      <div className="tpl-thumb" onClick={onEdit}>
        <div
          className="tp-paper-wrap"
          style={{ transform: `scale(${scale})`, left: offsetX }}
        >
          <InvoicePaper config={tpl.config} biz={biz} paymentMethods={payLines} paymentTerms={paymentTerms} />
        </div>

        {tpl.isDefault && <div className="tpl-badge default-badge">Défaut</div>}
        {!tpl.isDefault && (
          <div className="tpl-badge">
            <Icon name="layout-grid" size={13} ariaHidden />
            {LAYOUTS.find(l => l.key === tpl.config.layout)?.label}
          </div>
        )}

        <div className="tpl-hoverbtn">
          <button className="btn" onClick={e => { e.stopPropagation(); onEdit(); }}>
            <Icon name={canEdit ? 'edit' : 'eye'} size={14} ariaHidden />
            {canEdit ? 'Personnaliser' : 'Aperçu'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="tpl-body">
        <div className="tpl-name-row">
          <div
            className="tpl-pic"
            style={{ background: tpl.config.color }}
          >
            <Icon name="file-invoice" size={16} ariaHidden />
          </div>
          <div>
            <div className="tpl-name">{tpl.name}</div>
            <div className="tpl-purpose">{tpl.purpose}</div>
          </div>
        </div>
        <div className="tpl-meta">
          {tpl.chips.map(c => <span key={c} className="tpl-chip">{c}</span>)}
        </div>
        <div className="tpl-foot">
          {canEdit && (
            <button className="btn btn-sm tpl-star" onClick={onToggleStar} disabled={busy}
              aria-label={tpl.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'} title={tpl.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
              <Icon name={tpl.starred ? 'star-filled' : 'star'} size={15} ariaHidden />
            </button>
          )}
          <button className="btn btn-sm" onClick={onEdit}>
            <Icon name={canEdit ? 'edit' : 'eye'} size={14} ariaHidden />
            {canEdit ? 'Modifier' : 'Aperçu'}
          </button>
          {canEdit && !tpl.isDefault && (
            <button className="btn btn-sm btn-primary" onClick={onUse} disabled={busy}>
              <Icon name="check" size={14} ariaHidden />
              Utiliser
            </button>
          )}
          {tpl.isDefault && <span className="tpl-chip">Utilisé pour vos factures</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor controls panel
// ---------------------------------------------------------------------------
function EditorControls({ cfg, onChange }: { cfg: PaperConfig; onChange: (c: PaperConfig) => void }) {
  function set<K extends keyof PaperConfig>(k: K, v: PaperConfig[K]) {
    onChange({ ...cfg, [k]: v });
  }

  // Quantities, VAT, discount and payment details always appear: they are
  // mentions an invoice must carry, so a template can't hide them
  const SEC_OPTS: { key: keyof PaperConfig; label: string; sub: string }[] = [
    { key: 'showSignature', label: 'Signature',          sub: 'Ligne de signature' },
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
      <div className="ed-group">
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
      </div>

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

  if (loading || saved === null) return <PageSkeleton title="Modèles de factures" subtitle="Personnalisez vos modèles" variant="table-only" rows={4} />;

  function openEditor(id: string) {
    const tpl = id === 'new'
      ? { id: 'new', name: 'Nouveau modèle', config: DEFAULT_CONFIG }
      : templates.find(t => t.id === id)!;
    setEdConfig({ ...tpl.config });
    setEdName(tpl.name);
    setView({ kind: 'editor', id });
    setZoom(100);
  }

  function closeEditor() {
    setView('gallery');
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
    const name = edName.trim() || 'Nouveau modèle';
    const config = { ...edConfig };
    void run(async () => {
      if (id === 'new') {
        await createTemplate(orgId, { name, config });
      } else {
        const tpl = templates.find(t => t.id === id)!;
        await ensureSaved(tpl, { name, config });
        // Editing the template in use changes the next PDFs straight away
        if (tpl.isDefault) setInvoiceTemplate(config);
      }
      showToast('Modèle enregistré');
      setView('gallery');
    }, "Le modèle n'a pas pu être enregistré. Réessayez.");
  }

  function toggleStar(id: string) {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    void run(async () => { await ensureSaved(tpl, { starred: !tpl.starred }); }, "Le favori n'a pas pu être enregistré.");
  }

  function applyTemplate(id: string) {
    const tpl = templates.find(t => t.id === id);
    if (!tpl) return;
    void run(async () => {
      const row = await ensureSaved(tpl);
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

  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ===== GALLERY VIEW ===== */}
      {view === 'gallery' && (
        <>
          <div className="topbar">
            <div>
              <div className="page-title">Modèles de facture</div>
              <div className="page-sub">Choisissez un design prêt à l'emploi ou créez le vôtre</div>
            </div>
            {managesOrg && (
              <div className="topbar-actions">
                <button className="btn btn-primary" onClick={() => openEditor('new')}>
                  <Icon name="plus" size={16} ariaHidden />
                  Créer un modèle
                </button>
              </div>
            )}
          </div>

          <div className="content">
            <div className="gallery-wrap">
              {/* Intro banner */}
              <div className="gallery-intro">
                <div className="gi-ico"><Icon name="sparkles" size={19} ariaHidden /></div>
                <div>
                  <div className="gi-title">Vos factures, à votre image</div>
                  <div className="gi-sub">
                    Le modèle utilisé s'applique à toutes vos factures et devis en PDF. Personnalisez la mise en page, les couleurs et la police : les mentions obligatoires (identifiants fiscaux, quantités, TVA, modes de paiement) restent toujours affichées.
                  </div>
                  {!managesOrg && <div className="gi-sub" style={{ marginTop: 6 }}>Seuls les administrateurs peuvent changer de modèle.</div>}
                  {loadError && <div className="gi-sub" role="alert" style={{ marginTop: 6, color: 'var(--color-danger, #B42318)' }}>Vos modèles enregistrés n'ont pas pu être chargés. <button className="btn btn-sm" onClick={() => void load()}>Réessayer</button></div>}
                </div>
              </div>

              {/* Grid */}
              <div className="gallery-head">
                <div className="gallery-title">
                  Tous les modèles <span className="cnt">{templates.length}</span>
                </div>
              </div>

              <div className="tpl-grid">
                {templates.length === 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <EmptyState
                      illustration={<TemplatesEmptyIllustration />}
                      title="Aucun modèle"
                      description="Vous n'avez pas encore de modèles. Créez-en un pour gagner du temps."
                    />
                  </div>
                )}
                {templates.map(tpl => (
                  <TemplateCard
                    key={tpl.id}
                    tpl={tpl}
                    biz={orgSettings}
                    payLines={payLines}
                    paymentTerms={orgSettings.paymentTerms}
                    canEdit={managesOrg}
                    busy={busy}
                    onEdit={() => openEditor(tpl.id)}
                    onUse={() => applyTemplate(tpl.id)}
                    onToggleStar={() => toggleStar(tpl.id)}
                  />
                ))}

                {/* Create blank card */}
                {managesOrg && <div className="tpl-card create" onClick={() => openEditor('new')}>
                  <div className="create-inner">
                    <div className="create-ico"><Icon name="plus" size={26} ariaHidden /></div>
                    <div className="create-title">Modèle vierge</div>
                    <div className="create-sub">Partez de zéro et configurez chaque détail</div>
                  </div>
                </div>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== EDITOR VIEW ===== */}
      {view !== 'gallery' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Editor topbar */}
          <div className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <button className="crumb-back" onClick={closeEditor} aria-label="Retour aux modèles">
                <Icon name="arrow-left" ariaHidden />
              </button>
              <div>
                <input
                  className="ed-name-input"
                  value={edName}
                  onChange={e => setEdName(e.target.value)}
                  spellCheck={false}
                />
                <div className="ed-sub">
                  {editorTpl ? `Modification de "${editorTpl.name}"` : 'Nouveau modèle'}
                </div>
              </div>
            </div>
            <div className="topbar-actions">
              {managesOrg && (
                <>
                  <button className="btn" onClick={resetEditor} disabled={busy}>
                    <Icon name="arrow-down-left" size={15} ariaHidden />
                    Réinitialiser
                  </button>
                  <button className="btn btn-primary" onClick={saveTemplate} disabled={busy}>
                    <Icon name="check" size={15} ariaHidden />
                    {busy ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Editor body */}
          <div className="ed-body">
            {managesOrg && <EditorControls cfg={edConfig} onChange={setEdConfig} />}

            {/* Preview */}
            <div className="ed-preview">
              <div className="ed-preview-bar">
                <span style={{ flex: 1, textAlign: 'left' }}>
                  {LAYOUTS.find(l => l.key === edConfig.layout)?.label} · {edConfig.density}
                </span>
                <button className="zoom-btn" onClick={() => zoomStep(-1)} aria-label="Zoom arrière">−</button>
                <span className="zoom-val">{zoom}%</span>
                <button className="zoom-btn" onClick={() => zoomStep(1)} aria-label="Zoom avant">+</button>
              </div>
              <div className="ed-stage">
                <div
                  className="ed-paper-shadow"
                  style={{
                    transformOrigin: 'top center',
                    transform: `scale(${zoom / 100})`,
                    transition: 'transform .15s',
                    display: 'inline-block',
                  }}
                >
                  <InvoicePaper config={edConfig} biz={orgSettings} paymentMethods={payLines} paymentTerms={orgSettings.paymentTerms} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
