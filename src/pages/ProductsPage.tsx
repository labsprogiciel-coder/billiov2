import { useState, useMemo } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import { EmptyState } from '@/components/EmptyState';
import { ProductsEmptyIllustration } from '@/components/PageEmptyIllustrations';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { createProduct, updateProduct, removeProduct } from '@/lib/api/products';
import { lastChangeLabel } from '@/lib/change-label';
import { fmt, fmtCompact, fmtDate } from '@/data';
import type { ProductType, Product } from '@/lib/schemas';
import Page from '@/components/Page';

type FilterKey = 'all' | ProductType;
type ViewMode  = 'list' | 'grid';


const UNITS = ['heure', 'jour', 'projet', 'mois', 'an', 'article', 'licence'];

function TypePill({ type }: { type: ProductType }) {
  return type === 'service'
    ? <span className="type-pill t-service"><Icon name="briefcase" size="1em" ariaHidden /> Service</span>
    : <span className="type-pill t-product"><Icon name="tag" size="1em" ariaHidden /> Produit</span>;
}

export default function ProductsPage() {
  const { writable, deletable } = usePermissions();
  const { showToast, products, setProducts, orgId, loading } = useApp();

  if (loading) return <PageSkeleton title="Produits & Services" subtitle="Articles réutilisables pour vos factures et devis" variant="table-only" rows={6} />;
  const [filter, setFilter]         = useState<FilterKey>('all');
  const [view, setView]             = useState<ViewMode>('list');
  const [search, setSearch]         = useState('');
  const [panelOpen, setPanelOpen]   = useState(false);
  const [editId,    setEditId]      = useState<string | null>(null);
  const [dotsOpen,  setDotsOpen]    = useState<string | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

  // New item form state
  const [fType,  setFType]  = useState<ProductType>('service');
  const [fName,  setFName]  = useState('');
  const [fSku,   setFSku]   = useState('');
  const [fDesc,  setFDesc]  = useState('');
  const [fPrice, setFPrice] = useState(50_000);
  const [fUnit,  setFUnit]  = useState('heure');
  const [fTax,   setFTax]   = useState(18);

  const metrics = useMemo(() => {
    const services = products.filter(p => p.type === 'service').length;
    const goods    = products.filter(p => p.type === 'product').length;
    const revenue  = products.reduce((s, p) => s + p.price * p.used, 0);
    return { total: products.length, services, goods, revenue };
  }, [products]);

  const filterCounts = useMemo(() => ({
    all: products.length,
    service: products.filter(p => p.type === 'service').length,
    product: products.filter(p => p.type === 'product').length,
  }), [products]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (filter !== 'all' && p.type !== filter) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [products, filter, search]);

  const maxUsed = useMemo(() => Math.max(...products.map(p => p.used), 1), [products]);

  const openPanel = () => {
    setEditId(null);
    setFType('service'); setFName(''); setFSku('');
    setFDesc(''); setFPrice(50_000); setFUnit('heure'); setFTax(18);
    setPanelOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditId(p.id);
    setFType(p.type); setFName(p.name); setFSku(p.sku === '—' ? '' : p.sku);
    setFDesc(''); setFPrice(p.price); setFUnit(p.unit); setFTax(p.tax);
    setPanelOpen(true);
  };

  const handleDelete = (p: Product) => {
    setDotsOpen(null);
    setDeleteProduct(p);
  };

  const confirmDelete = async () => {
    if (!deleteProduct) return;
    const p = deleteProduct;
    setDeleteProduct(null);
    setProducts(prev => prev.filter(x => x.id !== p.id));
    try {
      await removeProduct(p.id);
      showToast(`"${p.name}" supprimé`);
    } catch (err) {
      console.error('[removeProduct] failed:', err);
      setProducts(prev => prev.some(x => x.id === p.id) ? prev : [p, ...prev]);
      showToast('Erreur lors de la suppression. Veuillez réessayer.', true);
    }
  };

  const submitItem = async () => {
    if (!fName.trim()) { showToast('Donnez un nom à cet article.', true); return; }
    if (editId) {
      const patch = { name: fName.trim(), sku: fSku.trim() || '—', type: fType, unit: fUnit, price: fPrice, tax: fTax, ico: fType === 'service' ? 'briefcase' : 'tag', color: fType === 'service' ? 'ico-blue' : 'ico-green' };
      const previous = products.find(p => p.id === editId);
      setProducts(prev => prev.map(p => p.id === editId ? { ...p, ...patch } : p));
      try {
        const change = await updateProduct(editId, patch);
        setProducts(prev => prev.map(p => p.id === editId ? { ...p, ...change } : p));
      } catch (err) {
        console.error('[updateProduct] failed:', err);
        if (previous) setProducts(prev => prev.map(p => p.id === editId ? previous : p));
        showToast('Erreur lors de la mise à jour. Veuillez réessayer.', true);
        return;
      }
      setPanelOpen(false);
      setEditId(null);
      showToast(`"${patch.name}" mis à jour`);
    } else {
      const item: Product = {
        id:    crypto.randomUUID(),
        name:  fName.trim(),
        sku:   fSku.trim() || '—',
        type:  fType,
        unit:  fUnit,
        price: fPrice,
        tax:   fTax,
        used:  0,
        ico:   fType === 'service' ? 'briefcase' : 'tag',
        color: fType === 'service' ? 'ico-blue' : 'ico-green',
      };
      setProducts(prev => [item, ...prev]);
      try {
        const stored = await createProduct(orgId, item);
        setProducts(prev => prev.map(p => p.id === item.id ? { ...p, updatedAt: stored.updatedAt, updatedByName: stored.updatedByName } : p));
      } catch (err) {
        console.error('[createProduct] failed:', err);
        setProducts(prev => prev.filter(p => p.id !== item.id));
        showToast('Erreur lors de l\'enregistrement de l\'article. Veuillez réessayer.', true);
        return;
      }
      posthog.capture('product_created', { type: fType, unit: fUnit });
      setPanelOpen(false);
      showToast(`"${item.name}" ajouté au catalogue`);
    }
  };

  return (
    <>
      <Page
        title="Produits & Services"
        subtitle="Articles réutilisables pour vos factures et devis"
        actions={<>
          <button className="btn"><Icon name="download" ariaHidden /> Exporter</button>
          {writable && (
            <button className="btn btn-primary" onClick={openPanel}>
              <Icon name="plus" ariaHidden /> Nouvel article
            </button>
          )}
        </>}
      >
          {/* Metrics */}
          <div className="metrics">
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico blue"><Icon name="package" size={15} ariaHidden /></div>
                <div className="metric-label">Articles au catalogue</div>
              </div>
              <div className="metric-value tnum">{metrics.total}<span className="metric-unit" /></div>
              <div className="metric-change"><span className="up"><Icon name="trending-up" size={14} ariaHidden />+2 ce mois</span></div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico violet"><Icon name="briefcase" size={15} ariaHidden /></div>
                <div className="metric-label">Services</div>
              </div>
              <div className="metric-value tnum">{metrics.services}<span className="metric-unit" /></div>
              <div className="metric-change" style={{ color: 'var(--color-text-secondary)' }}>facturés au temps ou au projet</div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico green"><Icon name="tag" size={15} ariaHidden /></div>
                <div className="metric-label">Produits</div>
              </div>
              <div className="metric-value tnum">{metrics.goods}<span className="metric-unit" /></div>
              <div className="metric-change" style={{ color: 'var(--color-text-secondary)' }}>articles à prix fixe</div>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico amber"><Icon name="cash" size={15} ariaHidden /></div>
                <div className="metric-label">Revenu catalogue</div>
              </div>
              <div className="metric-value tnum">{fmtCompact(metrics.revenue)}<span className="metric-unit">F CFA</span></div>
              <div className="metric-change" style={{ color: 'var(--color-text-secondary)' }}>cumulé, toutes factures</div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="section-header">
            <div className="section-title">Catalogue</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="search-box">
                <Icon name="search" ariaHidden />
                <input
                  type="text"
                  placeholder="Rechercher…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="filters">
                {([['all', 'Tous'], ['service', 'Services'], ['product', 'Produits']] as [FilterKey, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    className={`filter-chip${filter === key ? ' active' : ''}`}
                    onClick={() => setFilter(key)}
                  >
                    {label}<span className="cnt">{filterCounts[key] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="view-toggle">
                <button
                  className={view === 'list' ? 'active' : ''}
                  aria-label="Vue liste"
                  onClick={() => setView('list')}
                >
                  <Icon name="list" ariaHidden />
                </button>
                <button
                  className={view === 'grid' ? 'active' : ''}
                  aria-label="Vue grille"
                  onClick={() => setView('grid')}
                >
                  <Icon name="layout-grid" ariaHidden />
                </button>
              </div>
            </div>
          </div>

          {/* List view */}
          {view === 'list' && (
            <div className="prod-table">
              <div className="table-head prod-grid-cols">
                <div className="th">Article</div>
                <div className="th">Type</div>
                <div className="th">Unité</div>
                <div className="th right">Prix unitaire</div>
                <div className="th">Utilisé</div>
                <div className="th" />
              </div>
              {visible.length === 0 ? (
                <EmptyState
                  illustration={<ProductsEmptyIllustration />}
                  title="Aucun article trouvé"
                  description="Aucun article ne correspond à la recherche. Modifiez vos filtres."
                />
              ) : visible.map(p => (
                <div key={p.id} className="prod-row prod-grid-cols">
                  <div className="prod-name-cell">
                    <div className={`prod-ico ${p.color}`}>
                      <Icon name={p.ico} ariaHidden />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="prod-name">{p.name}</div>
                      <div className="prod-sku">{p.sku}</div>
                      {lastChangeLabel(p, fmtDate) && <div className="prod-changed">{lastChangeLabel(p, fmtDate)}</div>}
                    </div>
                  </div>
                  <div><TypePill type={p.type} /></div>
                  <div className="cell-unit">par {p.unit}</div>
                  <div className="price tnum" style={{ textAlign: 'right' }}>
                    {fmt(p.price)}<span className="cur">F CFA</span>
                  </div>
                  <div className="used-cell">
                    <div className="used-top tnum">{p.used}× <span>utilisé</span></div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${Math.round((p.used / maxUsed) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="row-actions" style={{ position: 'relative' }}>
                    {writable && (
                      <button className="icon-btn" aria-label="Modifier" onClick={e => { e.stopPropagation(); openEdit(p); }}>
                        <Icon name="edit" size={15} ariaHidden />
                      </button>
                    )}
                    {deletable && (
                      <button className="icon-btn" aria-label="Plus" onClick={e => { e.stopPropagation(); setDotsOpen(dotsOpen === p.id ? null : p.id); }}>
                        <Icon name="dots" size={15} ariaHidden />
                      </button>
                    )}
                    {deletable && dotsOpen === p.id && (
                      <div className="dropdown-menu" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 10 }}>
                        <button className="dropdown-item danger" onClick={() => handleDelete(p)}>
                          <Icon name="trash" size={14} ariaHidden /> Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Grid view */}
          {view === 'grid' && (
            <div className="prod-grid">
              {visible.length === 0 ? (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EmptyState
                    illustration={<ProductsEmptyIllustration />}
                    title="Aucun article trouvé"
                    description="Aucun article ne correspond à la recherche. Modifiez vos filtres."
                  />
                </div>
              ) : visible.map(p => (
                <div key={p.id} className="prod-card">
                  <div className="pc-top">
                    <div className={`prod-ico ${p.color}`}><Icon name={p.ico} ariaHidden /></div>
                    <TypePill type={p.type} />
                  </div>
                  <div className="pc-name">{p.name}</div>
                  <div className="pc-sku">{p.sku}</div>
                  {lastChangeLabel(p, fmtDate) && <div className="prod-changed">{lastChangeLabel(p, fmtDate)}</div>}
                  <div className="pc-price tnum">
                    {fmt(p.price)}<span className="cur">F CFA</span>
                    <span className="per"> / {p.unit}</span>
                  </div>
                  <div className="pc-foot">
                    <div className="pc-used"><b className="tnum">{p.used}×</b> sur factures</div>
                    {writable && (
                      <button className="icon-btn" aria-label="Modifier" onClick={e => { e.stopPropagation(); openEdit(p); }}>
                        <Icon name="edit" size={15} ariaHidden />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
      </Page>

      {/* Slide-over: New item */}
      <div className={`scrim${panelOpen ? ' open' : ''}`} onClick={() => setPanelOpen(false)} />
      <div className={`new-inv-panel${panelOpen ? ' open' : ''}`} role="dialog" aria-label="Nouvel article" aria-modal="true">
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">{editId ? 'Modifier l\'article' : 'Nouvel article'}</div>
            <div className="panel-slide-sub">{editId ? 'Mettre à jour les informations' : 'Enregistrez-le une fois, réutilisez sur toute facture'}</div>
          </div>
          <button className="icon-btn" onClick={() => setPanelOpen(false)} aria-label="Fermer">
            <Icon name="x" size={15} ariaHidden />
          </button>
        </div>

        <div className="panel-body">
          {/* Type selector */}
          <div className="form-group">
            <label className="form-label">Type</label>
            <div className="seg">
              <button
                className={`seg-opt${fType === 'service' ? ' active' : ''}`}
                onClick={() => setFType('service')}
              >
                <Icon name="briefcase" ariaHidden /> Service
              </button>
              <button
                className={`seg-opt${fType === 'product' ? ' active' : ''}`}
                onClick={() => setFType('product')}
              >
                <Icon name="package" ariaHidden /> Produit
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Nom</label>
            <input type="text" className="form-input" placeholder="ex. Développement web"
              value={fName} onChange={e => setFName(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">SKU / Référence</label>
            <input type="text" className="form-input" placeholder="ex. DEV-WEB"
              value={fSku} onChange={e => setFSku(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-input" rows={2} placeholder="Courte description affichée sur la ligne de facture…"
              value={fDesc} onChange={e => setFDesc(e.target.value)} style={{ resize: 'none', lineHeight: 1.5 }} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Prix unitaire</label>
              <div className="input-affix">
                <input type="number" min={0} value={fPrice}
                  onChange={e => setFPrice(parseFloat(e.target.value) || 0)} />
                <span className="suffix">F CFA</span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Par</label>
              <select className="form-input" value={fUnit} onChange={e => setFUnit(e.target.value)}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">TVA par défaut</label>
            <div className="input-affix">
              <input type="number" min={0} value={fTax}
                onChange={e => setFTax(parseFloat(e.target.value) || 0)} />
              <span className="suffix">%</span>
            </div>
          </div>
        </div>

        <div className="panel-footer">
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPanelOpen(false)}>
            Annuler
          </button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={submitItem}>
            <Icon name="check" ariaHidden /> Enregistrer
          </button>
        </div>
      </div>
      {deleteProduct && (
        <ConfirmModal
          title="Supprimer l'article"
          body={`Supprimer "${deleteProduct.name}" ? Cette action est irréversible.`}
          confirmLabel="Supprimer l'article"
          onConfirm={confirmDelete}
          onClose={() => setDeleteProduct(null)}
        />
      )}
    </>
  );
}
