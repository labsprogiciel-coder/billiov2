import { useState } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { createProduct, updateProduct, removeProduct } from '@/lib/api/products';
import type { ProductType, Product } from '@/lib/schemas';
import Page from '@/components/Page';
import ProductTable from '@/components/products/ProductTable';
import { CATALOGUE_CSV_HEADER, catalogueCsvRows } from '@/lib/catalogue';
import { csvBlob } from '@/lib/csv';
import { downloadBlob } from '@/lib/download';
import { todayISO } from '@/lib/invoice-status';



const UNITS = ['heure', 'jour', 'projet', 'mois', 'an', 'article', 'licence'];

export default function ProductsPage() {
  const { writable, deletable } = usePermissions();
  const { showToast, products, setProducts, orgId, loading } = useApp();

  const [panelOpen, setPanelOpen]   = useState(false);
  const [editId,    setEditId]      = useState<string | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

  // New item form state
  const [fType,  setFType]  = useState<ProductType>('service');
  const [fName,  setFName]  = useState('');
  const [fSku,   setFSku]   = useState('');
  const [fDesc,  setFDesc]  = useState('');
  const [fPrice, setFPrice] = useState(50_000);
  const [fUnit,  setFUnit]  = useState('heure');
  const [fTax,   setFTax]   = useState(18);

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
        setProducts(prev => prev.map(p => p.id === item.id ? { ...p, updatedAt: stored.updatedAt, updatedByName: stored.updatedByName, createdById: stored.createdById } : p));
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

  // Waits until every hook above has run: returning earlier changes their
  // number between renders, which React refuses
  if (loading) return <PageSkeleton title="Produits & Services" subtitle="Articles réutilisables pour vos factures et devis" variant="table-only" rows={6} />;

  // « Exporter »: the catalogue as a CSV for Excel
  const exportCatalogue = () => {
    if (products.length === 0) { showToast('Aucun article à exporter.', true); return; }
    downloadBlob(csvBlob(CATALOGUE_CSV_HEADER, catalogueCsvRows(products)), `catalogue-${todayISO()}.csv`);
  };

  return (
    <>
      <Page
        title="Produits & Services"
        subtitle="Articles réutilisables pour vos factures et devis"
        actions={<>
          <button className="btn" onClick={exportCatalogue}><Icon name="download" ariaHidden /> Exporter</button>
          {writable && (
            <button className="btn btn-primary" onClick={openPanel}>
              <Icon name="plus" ariaHidden /> Nouvel article
            </button>
          )}
        </>}
      >
            <ProductTable writable={writable} deletable={deletable} onEdit={openEdit} onDelete={handleDelete} />
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
