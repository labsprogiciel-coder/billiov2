import { useState, useMemo } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import posthog from 'posthog-js';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import { EmptyState, EmptyInline } from '@/components/EmptyState';
import { ClientsEmptyIllustration } from '@/components/PageEmptyIllustrations';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { createClient, updateClient, removeClient } from '@/lib/api/clients';
import { fmt, fmtCompact, clientInitials } from '@/data';
import type { ClientStatus, ClientRecord, InvoiceStatus, NewClientForm } from '@/lib/schemas';
import Page from '@/components/Page';

type FilterKey = 'all' | 'active' | 'lead' | 'balance';

interface MiniInv {
  id: string;
  sub: string;
  amt: number;
  status: InvoiceStatus;
}

const STATUS_LABEL: Record<ClientStatus, string> = {
  active:   'Actif',
  lead:     'Prospect',
  inactive: 'Inactif',
};

const INV_STATUS_LABEL: Record<MiniInv['status'], string> = {
  paid:    'Payée',
  pending: 'En attente',
  overdue: 'En retard',
  draft:   'Brouillon',
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',     label: 'Tous'         },
  { key: 'active',  label: 'Actifs'       },
  { key: 'lead',    label: 'Prospects'    },
  { key: 'balance', label: 'Avec solde'   },
];

const EMPTY_FORM: NewClientForm = {
  name: '', contact: '', email: '', country: '', phone: '', city: '', status: 'active', ifu: '', rccm: '', taxRegime: '', fiscalDivision: '',
};


export default function ClientsPage() {
  const { writable, deletable } = usePermissions();
  const { clients, setClients, invoices, orgId, showToast, loading } = useApp();

  const [filter, setFilter]   = useState<FilterKey>('all');
  const [search, setSearch]   = useState('');
  const [panel, setPanel]     = useState<null | { kind: 'detail'; code: string } | { kind: 'new' }>(null);
  const [form, setForm]       = useState<NewClientForm>(EMPTY_FORM);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<NewClientForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);

  const totalBilled  = clients.reduce((s, c) => s + c.billed, 0);
  const outstanding  = clients.reduce((s, c) => s + c.balance, 0);
  const activeCount  = clients.filter(c => c.status === 'active').length;
  const withBalance  = clients.filter(c => c.balance > 0).length;
  const leadCount    = clients.filter(c => c.status === 'lead').length;

  const counts = {
    all:     clients.length,
    active:  activeCount,
    lead:    leadCount,
    balance: withBalance,
  };

  const filtered = useMemo(() => {
    let list = clients;
    if (filter === 'active')  list = list.filter(c => c.status === 'active');
    if (filter === 'lead')    list = list.filter(c => c.status === 'lead');
    if (filter === 'balance') list = list.filter(c => c.balance > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.contact.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q),
      );
    }
    return list;
  }, [clients, filter, search]);

  const detailClient = panel?.kind === 'detail'
    ? clients.find(c => c.code === panel.code) ?? null
    : null;

  function closePanel() { setPanel(null); setEditMode(false); }

  function openDetailEdit(cl: ClientRecord | null) {
    if (!cl) return;
    setEditForm({ name: cl.name, country: cl.country ?? '', contact: cl.contact === '—' ? '' : cl.contact, email: cl.email === '—' ? '' : cl.email, phone: cl.phone === '—' ? '' : cl.phone, city: cl.city === '—' ? '' : cl.city, status: cl.status, ifu: cl.ifu ?? '', rccm: cl.rccm ?? '', taxRegime: cl.taxRegime ?? '', fiscalDivision: cl.fiscalDivision ?? '', withholdingScenario: cl.withholdingScenario });
    setEditMode(true);
  }

  async function handleSaveEdit(cl: ClientRecord | null) {
    if (!cl) return;
    const patch = { name: editForm.name, contact: editForm.contact || '—', email: editForm.email || '—', phone: editForm.phone || '—', city: editForm.city || '—', status: editForm.status, ifu: editForm.ifu, rccm: editForm.rccm, taxRegime: editForm.taxRegime, withholdingScenario: editForm.withholdingScenario };
    setClients(prev => prev.map(c => c.code === cl.code ? { ...c, ...patch } : c));
    await updateClient(orgId, cl.code, patch);
    setEditMode(false);
    showToast('Client mis à jour');
  }

  function handleDeleteClient(cl: ClientRecord | null) {
    if (!cl) return;
    setDeleteTarget(cl);
  }

  async function handleConfirmDeleteClient() {
    if (!deleteTarget) return;
    const { code, name } = deleteTarget;
    setClients(prev => prev.filter(c => c.code !== code));
    await removeClient(orgId, code);
    closePanel();
    showToast(`"${name}" supprimé`);
  }

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const avs   = ['av-a','av-b','av-c','av-d','av-e','av-f','av-g','av-h'];
    const payload = {
      av: avs[clients.length % avs.length],
      name: form.name, contact: form.contact || '—',
      email: form.email || '—', phone: form.phone || '—',
      city: form.city || '—', ifu: form.ifu, rccm: form.rccm, taxRegime: form.taxRegime,
      withholdingScenario: form.withholdingScenario,
      status: form.status,
    };
    const isFirstClient = clients.length === 0;
    let created: ClientRecord;
    try {
      created = await createClient(orgId, payload);
    } catch (err) {
      console.error('[createClient]', err);
      showToast('Erreur lors de l\'enregistrement du client. Veuillez réessayer.', true);
      return;
    }
    setClients(prev => prev.some(c => c.code === created.code) ? prev : [created, ...prev]);
    posthog.capture('client_created');
    if (isFirstClient) posthog.capture('first_client_added');
    setForm(EMPTY_FORM);
    closePanel();
  }

  if (loading) return <PageSkeleton title="Clients" subtitle="Tous vos clients en un seul endroit" variant="table-only" rows={6} />;

  return (
    <>
      <Page
        title="Clients"
        subtitle="Tous vos clients en un seul endroit"
        actions={<>
          {writable && (
            <button className="btn btn-primary" onClick={() => setPanel({ kind: 'new' })}>
              <Icon name="user-plus" size={16} />
              Nouveau client
            </button>
          )}
        </>}
      >
          {/* Metrics */}
          <div className="metrics">
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico blue"><Icon name="users" size={15} /></div>
                <div className="metric-label">Total clients</div>
              </div>
              <div className="metric-value">{clients.length}</div>
              <div className="metric-change neutral">+2 ce trimestre</div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico green"><Icon name="user" size={15} /></div>
                <div className="metric-label">Actifs</div>
              </div>
              <div className="metric-value">{activeCount}</div>
              <div className="metric-change neutral">{leadCount} prospect{leadCount !== 1 ? 's' : ''} en pipeline</div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico violet"><Icon name="cash" size={15} /></div>
                <div className="metric-label">Total facturé</div>
              </div>
              <div className="metric-value">
                {fmtCompact(totalBilled)}<span className="metric-unit">F CFA</span>
              </div>
              <div className="metric-change neutral">revenu cumulé</div>
            </div>
            <div className="metric-card">
              <div className="metric-top">
                <div className="metric-ico amber"><Icon name="clock-pause" size={15} /></div>
                <div className="metric-label">Solde impayé</div>
              </div>
              <div className="metric-value">
                {fmtCompact(outstanding)}<span className="metric-unit">F CFA</span>
              </div>
              <div className="metric-change neutral">{withBalance} client{withBalance !== 1 ? 's' : ''} avec solde</div>
            </div>
          </div>

          {/* Section header */}
          <div className="section-header">
            <div className="section-title">Répertoire</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="search-box">
                <Icon name="search" size={15} ariaHidden />
                <input
                  type="text"
                  aria-label="Rechercher un client"
                  placeholder="Rechercher un client…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="filters">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    className={'filter-chip' + (filter === f.key ? ' active' : '')}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}<span className="cnt">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Client table */}
          <div className="client-table">
            <div className="table-head client-grid-cols">
              <div className="th">Client</div>
              <div className="th">Localisation</div>
              <div className="th">Factures</div>
              <div className="th right">Total facturé</div>
              <div className="th">Statut</div>
              <div className="th" />
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                illustration={<ClientsEmptyIllustration />}
                title="Aucun client trouvé"
                description="Aucun client ne correspond à votre recherche. Essayez d'autres termes."
              />
            ) : (
              filtered.map(cl => (
                <div
                  key={cl.code}
                  className="client-row client-grid-cols"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPanel({ kind: 'detail', code: cl.code })}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setPanel({ kind: 'detail', code: cl.code })}
                >
                  {/* Name */}
                  <div className="name-cell">
                    <div className={`cl-av ${cl.av}`}>{clientInitials(cl.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="cl-name">{cl.name}</div>
                      <div className="cl-contact">{cl.contact}</div>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="loc-cell">
                    <Icon name="map-pin" size={14} />
                    <span>{cl.city}</span>
                  </div>

                  {/* Invoices */}
                  <div className="inv-count tnum">
                    {cl.invoices} <span>facture{cl.invoices !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Billed */}
                  <div style={{ textAlign: 'right' }}>
                    <div className="billed tnum">
                      {fmt(cl.billed)}<span className="cur">F CFA</span>
                    </div>
                    {cl.balance > 0
                      ? <div className="billed-sub bal">{fmt(cl.balance)} F CFA dû</div>
                      : cl.billed > 0
                        ? <div className="billed-sub clear">Tout réglé</div>
                        : <div className="billed-sub" style={{ color: 'var(--color-text-tertiary)' }}>Aucune facture</div>
                    }
                  </div>

                  {/* Status */}
                  <div>
                    <span className={`status-pill s-${cl.status}`}>{STATUS_LABEL[cl.status]}</span>
                  </div>

                  {/* Actions */}
                  <div className="row-actions" onClick={e => e.stopPropagation()}>
                    <button className="icon-btn" aria-label="Plus">
                      <Icon name="dots" size={15} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
      </Page>

      {/* Scrim */}
      <div className={'scrim' + (panel ? ' open' : '')} onClick={closePanel} />

      {/* Detail panel */}
      <div className={'new-inv-panel' + (panel?.kind === 'detail' ? ' open' : '')}>
        {detailClient && (
          <>
            <div className="panel-slide-head">
              <div>
                <div className="panel-slide-title">Client</div>
                <div className="panel-slide-sub">Aperçu &amp; historique</div>
              </div>
              <button className="icon-btn" onClick={closePanel} aria-label="Fermer">
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="panel-body">
              {/* Hero */}
              <div className="detail-hero">
                <div className={`detail-av ${detailClient.av}`}>{clientInitials(detailClient.name)}</div>
                <div>
                  <div className="detail-name">{detailClient.name}</div>
                  <div className="detail-meta">{detailClient.contact} · {detailClient.city}</div>
                </div>
              </div>

              {/* Stats */}
              <div className="stat-row">
                <div className="stat-box">
                  <div className="stat-label">Total facturé</div>
                  <div className="stat-val tnum">
                    {fmtCompact(detailClient.billed)}<span className="cur">F CFA</span>
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Solde impayé</div>
                  <div className={'stat-val tnum' + (detailClient.balance > 0 ? ' bal' : '')}>
                    {fmtCompact(detailClient.balance)}<span className="cur">F CFA</span>
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div className="detail-block">
                <div className="detail-block-title">Contact</div>
                {editMode ? (
                  <>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Raison sociale</label>
                      <input className="form-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Contact principal</label>
                      <input className="form-input" value={editForm.contact} onChange={e => setEditForm(f => ({ ...f, contact: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Email</label>
                      <input className="form-input" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Téléphone</label>
                      <input className="form-input" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 8 }}>
                      <label className="form-label">Ville</label>
                      <input className="form-input" value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Statut</label>
                      <select className="form-input" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as ClientStatus }))}>
                        <option value="active">Actif</option>
                        <option value="lead">Prospect</option>
                        <option value="inactive">Inactif</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="contact-line">
                      <Icon name="mail" size={16} />
                      <span>{detailClient.email}</span>
                    </div>
                    <div className="contact-line">
                      <Icon name="phone" size={16} />
                      <span>{detailClient.phone}</span>
                    </div>
                    <div className="contact-line">
                      <Icon name="map-pin" size={16} />
                      <span>{detailClient.city}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Identifiants fiscaux */}
              {(detailClient.ifu || detailClient.rccm || detailClient.taxRegime) && (
                <div className="detail-block">
                  <div className="detail-block-title">Identifiants fiscaux</div>
                  {detailClient.ifu && (
                    <div className="contact-line">
                      <Icon name="file-text" size={16} />
                      <span>IFU&nbsp;<strong>{detailClient.ifu}</strong></span>
                    </div>
                  )}
                  {detailClient.rccm && (
                    <div className="contact-line">
                      <Icon name="building" size={16} />
                      <span>RCCM&nbsp;<strong>{detailClient.rccm}</strong></span>
                    </div>
                  )}
                  {detailClient.taxRegime && (
                    <div className="contact-line">
                      <Icon name="tag" size={16} />
                      <span>Régime&nbsp;<strong>{detailClient.taxRegime}</strong></span>
                    </div>
                  )}
                </div>
              )}

              {/* Recent invoices */}
              <div className="detail-block">
                <div className="detail-block-title">Factures récentes</div>
                {(() => {
                  const recentInvs: MiniInv[] = invoices
                    .filter(i => i.client === detailClient.code)
                    .slice(0, 5)
                    .map(i => ({ id: i.id, sub: i.subject, amt: i.amount, status: i.status }));
                  return recentInvs.length === 0 ? (
                    <EmptyInline message="Aucune facture pour ce client." />
                  ) : (
                    recentInvs.map(inv => (
                      <div key={inv.id} className="mini-inv">
                        <div>
                          <div className="mini-id">#{inv.id}</div>
                          <div className="mini-sub">{inv.sub}</div>
                        </div>
                        <div className="mini-amt">{fmt(inv.amt)} F CFA</div>
                        <span className={`mini-status st-${inv.status}`}>
                          {INV_STATUS_LABEL[inv.status]}
                        </span>
                      </div>
                    ))
                  );
                })()}
              </div>
            </div>

            <div className="panel-footer" style={{ flexDirection: 'column', gap: 8 }}>
              {editMode ? (
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditMode(false)}>
                    Annuler
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleSaveEdit(detailClient)}>
                    <Icon name="check" size={15} /> Enregistrer
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  {writable && (
                    <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openDetailEdit(detailClient)}>
                      <Icon name="edit" size={15} /> Modifier
                    </button>
                  )}
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                    <Icon name="plus" size={15} /> Nouvelle facture
                  </button>
                </div>
              )}
              {deletable && (
                <button className="btn btn-ghost btn-danger" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handleDeleteClient(detailClient)}>
                  <Icon name="trash" size={15} /> Supprimer ce client
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* New client panel */}
      <div className={'new-inv-panel' + (panel?.kind === 'new' ? ' open' : '')}>
        <div className="panel-slide-head">
          <div>
            <div className="panel-slide-title">Nouveau client</div>
            <div className="panel-slide-sub">Ajouter une entreprise que vous facturez</div>
          </div>
          <button className="icon-btn" onClick={closePanel} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>

        <form id="new-client-form" className="panel-body" onSubmit={handleAddClient}>
          <div className="form-group">
            <label className="form-label">Raison sociale</label>
            <input className="form-input" placeholder="ex. Faso Energy" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Contact principal</label>
            <input className="form-input" placeholder="ex. Awa Bamba" value={form.contact}
              onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="contact@entreprise.bf" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Téléphone</label>
              <input className="form-input" type="tel" placeholder="70 00 00 00" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Ville</label>
              <input className="form-input" placeholder="Ouagadougou" value={form.city}
                onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Statut</label>
              <select className="form-input" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as ClientStatus }))}>
                <option value="active">Actif</option>
                <option value="lead">Prospect</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                IFU <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span>
              </label>
              <input className="form-input" placeholder="00012345 B" value={form.ifu}
                onChange={e => setForm(f => ({ ...f, ifu: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">
                RCCM <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span>
              </label>
              <input className="form-input" placeholder="BF-OUA-2021-B-1234" value={form.rccm}
                onChange={e => setForm(f => ({ ...f, rccm: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">
              Régime fiscal <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel</span>
            </label>
            <select className="form-input" value={form.taxRegime}
              onChange={e => setForm(f => ({ ...f, taxRegime: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              <option value="RNI">RNI — Régime normal d'imposition (CA ≥ 50M F CFA)</option>
              <option value="RSI">RSI — Régime simplifié d'imposition (CA 15–50M F CFA)</option>
              <option value="CME">CME — Contribution des micro-entreprises (CA &lt; 15M F CFA)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Retenue à la source <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>— optionnel (Arts. 206–214 CGI)</span>
            </label>
            <select className="form-input" value={form.withholdingScenario ?? ''}
              onChange={e => setForm(f => ({ ...f, withholdingScenario: e.target.value as NewClientForm['withholdingScenario'] || undefined }))}>
              <option value="">— Pas de retenue —</option>
              <option value="resident-with-ifu">5 % — Prestataire résident avec IFU (Art.207)</option>
              <option value="resident-without-ifu">25 % — Prestataire résident sans IFU (Art.207)</option>
              <option value="construction">1 % — Travaux / BTP (Art.207)</option>
              <option value="non-resident">20 % — Prestataire non-résident (Art.212)</option>
            </select>
          </div>
        </form>

        <div className="panel-footer">
          <button type="button" className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={closePanel}>
            Annuler
          </button>
          <button type="submit" form="new-client-form" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            <Icon name="check" size={15} />
            Ajouter
          </button>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Supprimer le client"
          body={`Supprimer "${deleteTarget.name}" ? Cette action est irréversible.`}
          confirmLabel="Supprimer le client"
          onConfirm={handleConfirmDeleteClient}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
