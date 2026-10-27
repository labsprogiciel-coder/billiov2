import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import { QAIllustration } from '@/components/QAIllustrations';
import { EmptyState } from '@/components/EmptyState';
import { ActivityEmptyIllustration, InvoicesEmptyIllustration } from '@/components/PageEmptyIllustrations';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { fmt, fmtCompact, fmtDate, fmtDue, clientInitials } from '@/data';
import type { ActivityPart } from '@/data';

function ActivityLine({ parts }: { parts: ActivityPart[] }) {
  return (
    <div className="act-text">
      {parts.map((p, i) => p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>)}
    </div>
  );
}

type Role = 'admin' | 'accountant' | 'member';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  accountant: 'Comptable',
  member: 'Membre',
};

const ROLE_NOTES: Record<Role, string> = {
  admin: 'Accès complet — gestion et supervision',
  accountant: 'Saisie comptable et déclarations fiscales',
  member: 'Facturation et suivi client',
};

interface QATile {
  icon: string;
  label: string;
  sub: string;
  primary?: boolean;
  path?: string;
}

const ROLE_ACTIONS: Record<Role, QATile[]> = {
  admin: [
    { icon: 'file-plus', label: 'Nouvelle facture', sub: 'Envoyer rapidement', primary: true, path: '/invoices' },
    { icon: 'user-plus', label: 'Ajouter un client', sub: 'Carnet d\'adresses', path: '/clients' },
    { icon: 'chart-bar', label: 'Rapports', sub: 'Analyse des performances', path: '/reports' },
    { icon: 'credit-card', label: 'Paiements', sub: 'Suivi des encaissements', path: '/payments' },
  ],
  accountant: [
    { icon: 'notebook', label: 'Saisir une écriture', sub: 'Journal comptable', primary: true, path: '/accounting/journals' },
    { icon: 'book', label: 'Plan comptable', sub: 'Gérer les comptes', path: '/accounting/chart-of-accounts' },
    { icon: 'building-bank', label: 'Déclaration TVA', sub: 'Saisie fiscale', path: '/accounting/tax' },
    { icon: 'book-2', label: 'Balance', sub: 'Vue consolidée', path: '/accounting/trial-balance' },
  ],
  member: [
    { icon: 'file-plus', label: 'Nouvelle facture', sub: 'Envoyer rapidement', primary: true, path: '/invoices' },
    { icon: 'file-text', label: 'Nouveau devis', sub: 'Transformer en facture', path: '/invoices?tab=quotes' },
    { icon: 'users', label: 'Mes clients', sub: 'Carnet d\'adresses', path: '/clients' },
    { icon: 'bell', label: 'Rappels', sub: 'Suivi automatique', path: '/reminders' },
  ],
};

export default function DashboardPage() {
  const { invoices, activity, clientsMap, loading, userRole } = useApp();
  const navigate = useNavigate();
  const role = userRole as Role;

  if (loading) return <PageSkeleton title="Tableau de bord" variant="dashboard" />;

  const metrics = useMemo(() => {
    const totalInvoiced  = invoices.filter(i => i.status !== 'draft').reduce((s, i) => s + i.amount, 0);
    const collected      = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    const outstanding    = invoices.filter(i => i.status === 'overdue' || i.status === 'pending').reduce((s, i) => s + i.amount, 0);
    const overdueCount   = invoices.filter(i => i.status === 'overdue').length;
    const collectionRate = totalInvoiced ? Math.round((collected / totalInvoiced) * 100) : 0;
    return { totalInvoiced, collected, outstanding, overdueCount, collectionRate };
  }, [invoices]);


  return (
    <div className="main">
      <div className="topbar">
        <div>
          <div className="page-title">Tableau de bord</div>
          <div className="page-sub">Aperçu de juin 2026</div>
        </div>
        <div className="topbar-actions">
          <button className="btn"><Icon name="search" ariaHidden /> Rechercher</button>
          <button className="btn btn-icon" aria-label="Notifications"><Icon name="bell" ariaHidden /></button>
          <button className="btn btn-primary" onClick={() => navigate('/invoices')}>
            <Icon name="plus" ariaHidden /> Nouvelle facture
          </button>
        </div>
      </div>

      <div className="content">
        {/* Metrics */}
        <div className="metrics">
          <div className="metric-card">
            <div className="metric-top">
              <div className="metric-ico blue"><Icon name="file-invoice" size={15} ariaHidden /></div>
              <div className="metric-label">Total facturé</div>
            </div>
            <div className="metric-value tnum">{fmtCompact(metrics.totalInvoiced)}<span className="metric-unit">F CFA</span></div>
            <div className="metric-change"><span className="up"><Icon name="trending-up" size={14} ariaHidden />+12 % MoM</span></div>
          </div>

          <div className="metric-card">
            <div className="metric-top">
              <div className="metric-ico amber"><Icon name="clock-pause" size={15} ariaHidden /></div>
              <div className="metric-label">Impayé</div>
            </div>
            <div className="metric-value tnum">{fmtCompact(metrics.outstanding)}<span className="metric-unit">F CFA</span></div>
            <div className="metric-change"><span className="dn"><Icon name="alert-triangle" size={14} ariaHidden />{metrics.overdueCount} en retard</span></div>
          </div>

          <div className="metric-card">
            <div className="metric-top">
              <div className="metric-ico green"><Icon name="cash" size={15} ariaHidden /></div>
              <div className="metric-label">Encaissé</div>
            </div>
            <div className="metric-value tnum">{fmtCompact(metrics.collected)}<span className="metric-unit">F CFA</span></div>
            <div className="metric-change"><span className="up"><Icon name="trending-up" size={14} ariaHidden />{metrics.collectionRate} % collecté</span></div>
          </div>

          <div className="metric-card">
            <div className="metric-top">
              <div className="metric-ico violet"><Icon name="calendar-stats" size={15} ariaHidden /></div>
              <div className="metric-label">Délai moy. de paiement</div>
            </div>
            <div className="metric-value tnum">8,4<span className="metric-unit">jours</span></div>
            <div className="metric-change"><span className="up"><Icon name="trending-down" size={14} ariaHidden />−2,1 jours</span></div>
          </div>
        </div>

        {/* Recent invoices preview */}
        <div className="section-header">
          <div className="section-title">Factures récentes</div>
          <button className="panel-link" onClick={() => navigate('/invoices')}>Tout voir</button>
        </div>
        <div className="invoice-table" style={{ marginBottom: 18 }}>
          {invoices.length === 0 ? (
            <EmptyState
                illustration={<InvoicesEmptyIllustration />}
                title="Aucune facture récente"
                description="Vos factures récentes apparaîtront ici."
              />
          ) : (
          <>
          <div className="table-head grid-cols">
            <div className="th">Facture</div>
            <div className="th">Client</div>
            <div className="th">Émission / Échéance</div>
            <div className="th right">Montant</div>
            <div className="th">Statut</div>
            <div className="th" />
          </div>
          {invoices.slice(0, 4).map(inv => {
            const c = clientsMap[inv.client] ?? { name: inv.client, city: '—', av: 'av-a' };
            return (
              <div
                key={inv.id}
                className="inv-row grid-cols"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/invoices/${inv.id}`)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && navigate(`/invoices/${inv.id}`)}
              >
                <div>
                  <div className="inv-id">#{inv.id}</div>
                  <div className="inv-subject">{inv.subject}</div>
                </div>
                <div className="client-cell">
                  <div className={`client-av ${c.av}`}>{clientInitials(c.name)}</div>
                  <div>
                    <div className="cell-text">{c.name}</div>
                    <div className="cell-sub">{c.city}</div>
                  </div>
                </div>
                <div>
                  <div className="cell-text">{fmtDate(inv.issued)}</div>
                  <div className="cell-sub">{fmtDue(inv.due)}</div>
                </div>
                <div className="amount tnum" style={{ textAlign: 'right' }}>
                  {fmt(inv.amount)}<span className="cur">F CFA</span>
                </div>
                <div>
                  <span className={`status-pill s-${inv.status}`}>
                    {{ paid: 'Payée', overdue: 'En retard', pending: 'En attente', draft: 'Brouillon' }[inv.status]}
                  </span>
                </div>
                <div />
              </div>
            );
          })}
          </>
          )}
        </div>

        {/* Bottom panels */}
        <div className="bottom-grid">
          {/* Recent activity */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Activité récente</div>
              <button className="panel-link">Tout voir</button>
            </div>
            {activity.length === 0 ? (
              <EmptyState
                illustration={<ActivityEmptyIllustration />}
                title="Aucune activité récente"
                description="Les actions sur vos factures, clients et paiements apparaîtront ici."
              />
            ) : activity.slice(0, 5).map((item, i) => (
              <div key={i} className="activity-item">
                <div className={`act-dot ${item.kind}`} />
                <div>
                  <ActivityLine parts={item.parts} />
                  <div className="act-time">{item.time}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Role-based quick actions */}
          <div className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-head" style={{ flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
              <div className="qa-headline">
                <div className="panel-title">Actions rapides</div>
              </div>
              <div className="qa-role-note">
                <Icon name={role === 'admin' ? 'shield-check' : role === 'accountant' ? 'book' : 'user'} size={13} ariaHidden />
                {' '}<b>{ROLE_LABELS[role]}</b> — {ROLE_NOTES[role]}
              </div>
            </div>
            <div style={{ padding: '14px 17px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="qa-grid">
                {ROLE_ACTIONS[role].map((tile, i) => (
                  <button
                    key={i}
                    className={`qa-tile${tile.primary ? ' primary' : ''}`}
                    onClick={() => tile.path && navigate(tile.path)}
                  >
                    <QAIllustration icon={tile.icon} primary={tile.primary} />
                    <div className="qa-lbl">{tile.label}</div>
                    <div className="qa-sub">{tile.sub}</div>
                    <span className="qa-arrow"><Icon name="arrow-right" size={16} ariaHidden /></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
