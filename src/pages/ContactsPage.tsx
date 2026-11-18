import { invoiceRef } from '@/lib/invoice-number';
import { useState, useMemo, useEffect, useRef } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import { useSearchParams } from 'react-router-dom';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import { EmptyInline } from '@/components/EmptyState';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import FiscalDivisionSelect, { fiscalDivisionLabel } from '@/components/FiscalDivisionSelect';
import { createClient, updateClient, removeClient } from '@/lib/api/clients';
import { fmt, fmtCompact, clientInitials } from '@/data';
import { getFiscalIdLabel, OHADA_COUNTRY_NAMES } from '@/lib/ohada';
import { CLIENT_TYPES, clientTypeDef, clientTypeOf, type ClientType } from '@/lib/client-type';
import type { ClientStatus, ClientRecord, InvoiceStatus, NewClientForm } from '@/lib/schemas';
import Page from '@/components/Page';
import { OwnerLine } from '@/components/owner/OwnerControls';
import { useCommandIntent } from '@/lib/command-intent';
import ClientList from '@/components/contacts/ClientList';
import ClientRecordPanel from '@/components/contacts/ClientRecordPanel';
import { useCreditNotes } from '@/lib/use-credit-notes';
import { useClientDocuments } from '@/lib/use-client-documents';
import { kybItems, kybSummary } from '@/lib/kyb';
import { todayISO } from '@/lib/invoice-status';
import { invoiceRows } from '@/lib/sales-tables';
import { clientDocuments, clientRows } from '@/lib/client-table';

// ─── Clients sub-components ───────────────────────────────────────────────────

type MiniInv = { id: string; ref: string; sub: string; amt: number; status: InvoiceStatus };

const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { active: 'Actif', lead: 'Prospect', inactive: 'Inactif' };
const INV_STATUS_LABEL: Record<MiniInv['status'], string> = { paid: 'Payée', pending: 'En attente', overdue: 'En retard', draft: 'Brouillon' };
const EMPTY_FORM: NewClientForm = { name: '', contact: '', email: '', phone: '', city: '', country: 'Burkina Faso', status: 'active', ifu: '', rccm: '', taxRegime: '', fiscalDivision: '', clientType: 'PM' };
/** Type select (DGI client types); the IFU is required for PM and PC. */
function ClientTypeSelect({ value, onChange }: { value: ClientType; onChange: (t: ClientType) => void }) {
  return (
    <select className="form-input" value={value} onChange={e => onChange(e.target.value as ClientType)}>
      {CLIENT_TYPES.filter(t => t.code !== 'CC').map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
      {value === 'CC' && <option value="CC">{clientTypeDef('CC').label}</option>}
    </select>
  );
}
const ifuHint = (t: ClientType | undefined) => clientTypeDef(t ?? 'PP').ifuRequired ? '— requis' : '— optionnel';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { writable, deletable } = usePermissions();
  const [searchParams] = useSearchParams();
  // Clients data
  const { clients, setClients, invoices, quotes, payments, orgId, showToast, loading: clientsLoading } = useApp();
  // ?client=CODE opens that client's form (link from the invoice compliance warning)
  const [linkedClient] = useState(() => searchParams.get('client'));
  const [clientPanel, setClientPanel] = useState<null | { kind: 'detail'; code: string } | { kind: 'new' }>(
    () => linkedClient ? { kind: 'detail', code: linkedClient } : null,
  );
  const [form, setForm] = useState<NewClientForm>(EMPTY_FORM);
  // From the command box (PRO-162): a new client, or one found by the search
  useCommandIntent(intent => {
    if (intent.command === 'open-client') {
      // ERP look: the record opens beside the list (PRO-169)
      setSelectedCode(intent.client);
      return;
    }
    if (intent.command !== 'new-client' || !writable) return false;
    setClientPanel({ kind: 'new' });
  }, !clientsLoading);
  const [editMode, setEditMode] = useState(false);
  // ERP look (PRO-169): the client whose record shows beside the list
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<NewClientForm>(EMPTY_FORM);
  const [deleteClient, setDeleteClient] = useState<ClientRecord | null>(null);

  // ── useMemo calls must be unconditional (before any early return) ─────────

  // Compute invoice counts and amounts from the live invoices array — the stored
  // invoices_count/billed/balance columns on clients are never updated after creation.
  const clientStatsMap = useMemo(() => {
    const map = new Map<string, { count: number; billed: number; balance: number }>();
    for (const inv of invoices) {
      if (inv.status === 'draft') continue;
      const s = map.get(inv.client) ?? { count: 0, billed: 0, balance: 0 };
      s.count  += 1;
      s.billed += inv.amount;
      if (inv.status === 'pending' || inv.status === 'overdue') s.balance += inv.amount;
      map.set(inv.client, s);
    }
    return map;
  }, [invoices]);

  // ERP look: each client's figures from the invoices' real balances
  const creditNotes = useCreditNotes();
  const year = new Date().getFullYear();
  const invRows = useMemo(() => invoiceRows(invoices, payments, creditNotes), [invoices, payments, creditNotes]);
  const cRows = useMemo(() => clientRows(clients, invRows, year), [clients, invRows, year]);
  const selectedRow = cRows.find(c => c.code === selectedCode) ?? null;
  // KYB documents (PRO-176): every client's status for the list, details for the record
  const kyb = useClientDocuments();
  const kybByClient = useMemo(() => {
    const today = todayISO();
    return new Map(clients.map(c => [c.code, kybSummary(kybItems(clientTypeOf(c), kyb.docs.filter(d => d.clientCode === c.code), today))]));
  }, [clients, kyb.docs]);
  const selectedDocs = useMemo(() => clientDocuments(selectedCode ?? '', invRows, quotes), [selectedCode, invRows, quotes]);
  // In the ERP look the side panel is only the edit form: when editing ends,
  // close it and show that client's record beside the list
  useEffect(() => {
    if (clientPanel?.kind !== 'detail' || editMode) return;
    setSelectedCode(clientPanel.code);
    setClientPanel(null);
  }, [clientPanel, editMode]);

  const loading = clientsLoading;
  // Opens the linked client's form once it is loaded (writers only)
  const linkedEditOpened = useRef(false);
  useEffect(() => {
    if (!linkedClient || linkedEditOpened.current || !writable) return;
    const cl = clients.find(c => c.code === linkedClient);
    if (!cl) return;
    linkedEditOpened.current = true;
    openDetailEdit(cl);
  }, [linkedClient, clients, writable]);

  if (loading) return <PageSkeleton title="Contacts" subtitle="Vos clients" variant="accounting" rows={6} />;

  const detailClient = clientPanel?.kind === 'detail' ? clients.find(c => c.code === clientPanel.code) ?? null : null;

  function closeClientPanel() { setClientPanel(null); setEditMode(false); }
  function openDetailEdit(cl: ClientRecord | null) {
    if (!cl) return;
    setEditForm({ name: cl.name, contact: cl.contact === '—' ? '' : cl.contact, email: cl.email === '—' ? '' : cl.email, phone: cl.phone === '—' ? '' : cl.phone, city: cl.city === '—' ? '' : cl.city, country: cl.country ?? 'Burkina Faso', status: cl.status, ifu: cl.ifu ?? '', rccm: cl.rccm ?? '', taxRegime: cl.taxRegime ?? '', fiscalDivision: cl.fiscalDivision ?? '', clientType: clientTypeOf(cl) });
    setEditMode(true);
  }
  async function handleSaveEdit(cl: ClientRecord | null) {
    if (!cl) return;
    const patch = { name: editForm.name, contact: editForm.contact || '—', email: editForm.email || '—', phone: editForm.phone || '—', city: editForm.city || '—', country: editForm.country || 'Burkina Faso', status: editForm.status, ifu: editForm.ifu, rccm: editForm.rccm, taxRegime: editForm.taxRegime, fiscalDivision: editForm.fiscalDivision, clientType: editForm.clientType };
    const previous = clients.find(c => c.code === cl.code);
    setClients(prev => prev.map(c => c.code === cl.code ? { ...c, ...patch } : c));
    try {
      await updateClient(orgId, cl.code, patch);
      setEditMode(false);
      showToast('Client mis à jour');
    } catch (err) {
      if (previous) setClients(prev => prev.map(c => c.code === cl.code ? previous : c));
      showToast('Erreur lors de la mise à jour. Veuillez réessayer.', true);
      console.error('[updateClient]', err);
    }
  }
  function handleDeleteClient(cl: ClientRecord | null) {
    if (!cl) return;
    setDeleteClient(cl);
  }

  // Invoices, quotes and payments reference clients by code; deleting a client
  // that has any would leave those documents without a client.
  function documentCount(code: string) {
    return invoices.filter(i => i.client === code).length
      + quotes.filter(q => q.client === code).length
      + payments.filter(p => p.client === code).length;
  }

  async function archiveClient(cl: ClientRecord) {
    setDeleteClient(null);
    try {
      await updateClient(orgId, cl.code, { status: 'inactive' });
      setClients(prev => prev.map(c => c.code === cl.code ? { ...c, status: 'inactive' } : c));
      showToast(`"${cl.name}" est maintenant inactif`);
    } catch (err) {
      console.error('[archiveClient]', err);
      showToast('Erreur lors de la mise à jour. Veuillez réessayer.', true);
    }
  }

  async function confirmDeleteClient() {
    const cl = deleteClient;
    if (!cl) return;
    if (documentCount(cl.code) > 0) { await archiveClient(cl); return; }
    setDeleteClient(null);
    setClients(prev => prev.filter(c => c.code !== cl.code));
    try {
      await removeClient(orgId, cl.code);
      closeClientPanel();
      showToast(`"${cl.name}" supprimé`);
    } catch (err) {
      setClients(prev => [cl, ...prev]);
      showToast('Erreur lors de la suppression. Veuillez réessayer.', true);
      console.error('[removeClient]', err);
    }
  }
  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!orgId) { showToast('Impossible de sauvegarder : organisation introuvable.', true); return; }
    const avs = ['av-a','av-b','av-c','av-d','av-e','av-f','av-g','av-h'];
    const payload = { av: avs[clients.length % avs.length], name: form.name, contact: form.contact || '—', email: form.email || '—', phone: form.phone || '—', city: form.city || '—', country: form.country || 'Burkina Faso', ifu: form.ifu, rccm: form.rccm, taxRegime: form.taxRegime, fiscalDivision: form.fiscalDivision, clientType: form.clientType, status: form.status };
    try {
      // The code comes from the server sequence, so the client is added once it exists
      const created = await createClient(orgId, payload);
      setClients(prev => prev.some(c => c.code === created.code) ? prev : [created, ...prev]);
      setForm(EMPTY_FORM);
      closeClientPanel();
      showToast(`"${created.name}" ajouté`);
    } catch (err) {
      showToast('Erreur lors de l\'enregistrement du client. Veuillez réessayer.', true);
      console.error('[createClient]', err);
    }
  }

  return (
    <>
      <Page
        title="Contacts"
        subtitle="Vos clients"
        actions={<>
          <button className="btn"><Icon name="download" size={15} />Exporter</button>
          {writable && <button className="btn btn-primary" onClick={() => setClientPanel({ kind: 'new' })}><Icon name="user-plus" size={15} />Nouveau client</button>}
        </>}
        mainStyle={{ position: 'relative' }}
      >
          {/* ── Contextual KPI strip ──────────────────────────────────────── */}

          {/* ── Clients tab, ERP look (PRO-169): list with the record beside it ── */}
              <div className="cr-split">
                <ClientList rows={cRows} year={year} selected={selectedCode} onSelect={setSelectedCode} kyb={kybByClient} />
                <ClientRecordPanel
                  client={selectedRow}
                  year={year}
                  docs={selectedDocs}
                  kyb={kyb}
                  onClose={() => setSelectedCode(null)}
                  onEdit={code => { const cl = clients.find(c => c.code === code) ?? null; setClientPanel({ kind: 'detail', code }); openDetailEdit(cl); }}
                  onDelete={code => handleDeleteClient(clients.find(c => c.code === code) ?? null)}
                />
              </div>

          {/* ── Clients tab ──────────────────────────────────────────────── */}

      </Page>

      {/* ── Client panels ────────────────────────────────────────────────── */}
      <div className={'scrim' + (clientPanel ? ' open' : '')} onClick={closeClientPanel} />

      <div className={'new-inv-panel' + (clientPanel?.kind === 'detail' ? ' open' : '')}>
        {detailClient && (
          <>
            <div className="panel-slide-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className={`cl-av ${detailClient.av}`} style={{ width: 44, height: 44, borderRadius: 11, fontSize: 14 }}>{clientInitials(detailClient.name)}</div>
                <div>
                  <div className="panel-slide-title">{detailClient.name}</div>
                  <div className="panel-slide-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="map-pin" size={11} />{detailClient.city}
                    <span className={`status-pill s-${detailClient.status}`} style={{ marginLeft: 4 }}>{CLIENT_STATUS_LABEL[detailClient.status]}</span>
                  </div>
                </div>
              </div>
              <button className="icon-btn" onClick={closeClientPanel} aria-label="Fermer"><Icon name="x" size={18} /></button>
            </div>
            <div className="panel-body">
              <div className="stat-row">
                <div className="stat-box">
                  <div className="stat-label">Total facturé</div>
                  <div className="stat-val tnum">{fmtCompact(clientStatsMap.get(detailClient.code)?.billed ?? 0)}<span className="cur">F CFA</span></div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Solde impayé</div>
                  <div className={'stat-val tnum' + ((clientStatsMap.get(detailClient.code)?.balance ?? 0) > 0 ? ' bal' : '')}>{fmtCompact(clientStatsMap.get(detailClient.code)?.balance ?? 0)}<span className="cur">F CFA</span></div>
                </div>
              </div>
              <div className="detail-block">
                <div className="detail-block-title">Contact</div>
                {editMode ? (
                  <>
                    {[
                      { label: 'Raison sociale', key: 'name' as const, type: 'text' },
                      { label: 'Contact principal', key: 'contact' as const, type: 'text' },
                      { label: 'Email', key: 'email' as const, type: 'email' },
                      { label: 'Téléphone', key: 'phone' as const, type: 'text' },
                      { label: 'Ville', key: 'city' as const, type: 'text' },
                    ].map(({ label, key, type }) => (
                      <div key={key} className="form-group" style={{ marginBottom: 8 }}>
                        <label className="form-label">{label}</label>
                        <input className="form-input" type={type} value={editForm[key] as string} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} />
                      </div>
                    ))}
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Statut</label>
                      <select className="form-input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as ClientStatus }))}>
                        <option value="active">Actif</option>
                        <option value="lead">Prospect</option>
                        <option value="inactive">Inactif</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Pays</label>
                      <select className="form-input" value={editForm.country} onChange={e => setEditForm(f => ({ ...f, country: e.target.value }))}>
                        {OHADA_COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Type de client</label>
                      <ClientTypeSelect value={editForm.clientType ?? 'PP'} onChange={t => setEditForm(f => ({ ...f, clientType: t }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">{getFiscalIdLabel(editForm.country)} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{ifuHint(editForm.clientType)}</span></label>
                      <input className="form-input" type="text" placeholder="00012345 B" value={editForm.ifu} onChange={e => setEditForm(f => ({ ...f, ifu: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">RCCM <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <input className="form-input" type="text" placeholder="BF-OUA-2021-B-1234" value={editForm.rccm} onChange={e => setEditForm(f => ({ ...f, rccm: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Régime fiscal <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <input className="form-input" type="text" placeholder="RNI, RSI…" value={editForm.taxRegime} onChange={e => setEditForm(f => ({ ...f, taxRegime: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Division fiscale <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
                      <FiscalDivisionSelect value={editForm.fiscalDivision} onChange={v => setEditForm(f => ({ ...f, fiscalDivision: v }))} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="contact-line"><Icon name="mail" size={16} /><span>{detailClient.email}</span></div>
                    <div className="contact-line"><Icon name="phone" size={16} /><span>{detailClient.phone}</span></div>
                    <div className="contact-line"><Icon name="map-pin" size={16} /><span>{detailClient.city}</span></div>
                  </>
                )}
              </div>
              {!editMode && (
                <div className="detail-block">
                  <OwnerLine table="clients" id={detailClient.code} ownerId={detailClient.ownerId} ownerName={detailClient.ownerName} />
                </div>
              )}
              {!editMode && (
                <div className="detail-block">
                  <div className="detail-block-title">Identifiants fiscaux</div>
                  <div className="contact-line"><Icon name="users" size={16} /><span>Type&nbsp;<strong>{clientTypeDef(clientTypeOf(detailClient)).label}</strong></span></div>
                  {detailClient.ifu && <div className="contact-line"><Icon name="file-text" size={16} /><span>{getFiscalIdLabel(detailClient.country)}&nbsp;<strong>{detailClient.ifu}</strong></span></div>}
                  {detailClient.rccm && <div className="contact-line"><Icon name="building" size={16} /><span>RCCM&nbsp;<strong>{detailClient.rccm}</strong></span></div>}
                  {detailClient.taxRegime && <div className="contact-line"><Icon name="tag" size={16} /><span>Régime&nbsp;<strong>{detailClient.taxRegime}</strong></span></div>}
                  {detailClient.fiscalDivision && <div className="contact-line"><Icon name="sitemap" size={16} /><span>Division fiscale&nbsp;<strong>{fiscalDivisionLabel(detailClient.fiscalDivision)}</strong></span></div>}
                </div>
              )}
              <div className="detail-block">
                <div className="detail-block-title">Factures récentes</div>
                {(() => {
                  const recentInvs: MiniInv[] = invoices.filter(i => i.client === detailClient.code).slice(0, 5).map(i => ({ id: i.id, ref: invoiceRef(i), sub: i.subject, amt: i.amount, status: i.status }));
                  return recentInvs.length === 0 ? (
                    <EmptyInline message="Aucune facture pour ce client." />
                  ) : recentInvs.map(inv => (
                    <div key={inv.id} className="mini-inv">
                      <div><div className="mini-id">#{inv.ref}</div><div className="mini-sub">{inv.sub}</div></div>
                      <div className="mini-amt">{fmt(inv.amt)} F CFA</div>
                      <span className={`mini-status st-${inv.status}`}>{INV_STATUS_LABEL[inv.status]}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="panel-footer" style={{ flexDirection: 'column', gap: 8 }}>
              {editMode ? (
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditMode(false)}>Annuler</button>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleSaveEdit(detailClient)}><Icon name="check" size={15} /> Enregistrer</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  {writable && <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openDetailEdit(detailClient)}><Icon name="edit" size={15} /> Modifier</button>}
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}><Icon name="plus" size={15} /> Nouvelle facture</button>
                </div>
              )}
              {deletable && <button className="btn" style={{ width: '100%', justifyContent: 'center', color: '#A32D2D' }} onClick={() => handleDeleteClient(detailClient)}><Icon name="trash" size={15} /> Supprimer ce client</button>}
            </div>
          </>
        )}
      </div>

      <div className={'new-inv-panel' + (clientPanel?.kind === 'new' ? ' open' : '')}>
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">Nouveau client</div>
            <div className="panel-slide-sub">Ajouter une entreprise que vous facturez</div>
          </div>
          <button className="icon-btn" onClick={closeClientPanel} aria-label="Fermer"><Icon name="x" size={18} /></button>
        </div>
        <form id="new-client-form" className="panel-body" onSubmit={handleAddClient}>
          <div className="form-group">
            <label className="form-label">Raison sociale</label>
            <input className="form-input" placeholder="ex. Faso Energy" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Contact principal</label>
            <input className="form-input" placeholder="ex. Awa Bamba" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="contact@entreprise.bf" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Téléphone</label>
              <input className="form-input" type="tel" placeholder="70 00 00 00" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Ville</label>
              <input className="form-input" placeholder="Ouagadougou" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Pays</label>
              <select className="form-input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>
                {OHADA_COUNTRY_NAMES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Statut</label>
            <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ClientStatus }))}>
              <option value="active">Actif</option>
              <option value="lead">Prospect</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Type de client</label>
            <ClientTypeSelect value={form.clientType ?? 'PM'} onChange={t => setForm(f => ({ ...f, clientType: t }))} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">{getFiscalIdLabel(form.country)} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{ifuHint(form.clientType)}</span></label>
              <input className="form-input" placeholder={form.country === 'Sénégal' ? '0123456789123' : form.country === 'Cameroun' ? 'M012345678901R' : '00012345 B'} value={form.ifu} onChange={e => setForm(f => ({ ...f, ifu: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">RCCM <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
              <input className="form-input" placeholder="BF-OUA-2021-B-1234" value={form.rccm} onChange={e => setForm(f => ({ ...f, rccm: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Régime fiscal <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
            <select className="form-input" value={form.taxRegime} onChange={e => setForm(f => ({ ...f, taxRegime: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              <option value="RNI">RNI — Régime normal d'imposition (CA ≥ 50M F CFA)</option>
              <option value="RSI">RSI — Régime simplifié d'imposition (CA 15–50M F CFA)</option>
              <option value="CME">CME — Contribution des micro-entreprises (CA &lt; 15M F CFA)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Division fiscale <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span></label>
            <FiscalDivisionSelect value={form.fiscalDivision} onChange={v => setForm(f => ({ ...f, fiscalDivision: v }))} />
          </div>
        </form>
        <div className="panel-footer">
          <button type="button" className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={closeClientPanel}>Annuler</button>
          <button type="submit" form="new-client-form" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}><Icon name="check" size={15} />Ajouter</button>
        </div>
      </div>

      {/* ── Supplier drawers ─────────────────────────────────────────────── */}
      {deleteClient && (documentCount(deleteClient.code) > 0 ? (
        <ConfirmModal
          title="Ce client ne peut pas être supprimé"
          body={`"${deleteClient.name}" a ${documentCount(deleteClient.code)} document(s) (factures, devis ou paiements). Pour le retirer de vos listes sans perdre l'historique, passez-le en Inactif.`}
          confirmLabel="Passer en Inactif"
          onConfirm={confirmDeleteClient}
          onClose={() => setDeleteClient(null)}
        />
      ) : (
        <ConfirmModal
          title="Supprimer le client"
          body={`Supprimer "${deleteClient.name}" ? Cette action est irréversible.`}
          confirmLabel="Supprimer le client"
          onConfirm={confirmDeleteClient}
          onClose={() => setDeleteClient(null)}
        />
      ))}
    </>
  );
}
