import { invoiceRef } from '@/lib/invoice-number';
import { useState, useEffect } from 'react';
import { canWrite } from '@/lib/permissions';
import posthog from 'posthog-js';
import { useParams, useNavigate } from 'react-router-dom';
import RichTextView from '@/components/RichTextView';
import Icon from '@/components/Icon';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { fetchLineItems } from '@/lib/api/line-items';
import { renderInvoicePdf } from '@/lib/render-pdf';
import { downloadBlob } from '@/lib/download';
import { paymentMethodsNotReadyMessage, usePaymentMethods } from '@/lib/use-payment-methods';
import { fmt, fmtDateLong } from '@/data';
import type { LineItem } from '@/lib/schemas';
import { taxSummary, vatRows } from '@/lib/tax-groups';
import { chargesVat } from '@/lib/vat';
import Page from '@/components/Page';

const STATUS_LABEL: Record<string, string> = {
  draft:    'Brouillon',
  sent:     'Envoyé',
  accepted: 'Accepté',
  declined: 'Refusé',
  expired:  'Expiré',
  invoiced: 'Facturé',
};

const BillioLogoSvg = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5.5 3.2h10.2c.6 0 1.1.2 1.5.6l3 3c.4.4.6.9.6 1.5v12c0 .7-.6 1.1-1.2.8l-1.6-.8-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.7.9c-.3.2-.7.2-1 0l-1.6-.9-1.6.8c-.6.3-1.3-.1-1.3-.8V4.7c0-.8.7-1.5 1.5-1.5z" fill="#fff" fillOpacity="0.96"/>
    <path d="M8 8.2h6M8 11.4h7M8 14.6h4" stroke="#185FA5" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>
);

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { quotes, invoices, showToast, clientsMap, orgSettings, invoiceTemplate, orgId, loading, userRole } = useApp();
  const { lines: paymentMethods, status: paymentMethodsStatus } = usePaymentMethods();
  const paymentMethodsReady = paymentMethodsStatus === 'ready';
  const [lines, setLines] = useState<LineItem[]>([]);

  useEffect(() => {
    if (id && orgId) fetchLineItems(orgId, { quoteId: id }).then(setLines).catch(err => { console.error('[QuotePage] fetchLineItems error:', err); setLines([]); });
  }, [id, orgId]);

  if (loading) return <PageSkeleton title="Devis" variant="document" rows={4} />;

  const quote = quotes.find(q => q.id === id);
  if (!quote) {
    return (
      <Page
        back={{ label: "Retour", onClick: () => navigate('/quotes') }}
        title="Devis introuvable"
        contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)' }}
      >
          Le devis #{id} n'existe pas.
      </Page>
    );
  }

  const client       = clientsMap[quote.client] ?? { name: quote.client, city: '—', av: 'av-a' };
  // Invoice-level discount, set in the editor (PRO-185); 0 on older quotes
  const discountPct  = quote.discountPct ?? 0;
  const canInvoiceTVA = chargesVat(orgSettings.taxRegime);
  // Totals per DGI tax group (PRO-138)
  const sums         = taxSummary(lines, discountPct, canInvoiceTVA);
  const { subtotal, discount: discountAmt, total } = sums;

  const quoteUrl    = window.location.href;
  const isTerminal  = ['invoiced', 'declined', 'expired'].includes(quote.status);
  const canConvert  = !isTerminal && canWrite(userRole);
  const canEdit     = !isTerminal && canWrite(userRole);

  // Quotes are edited in the invoice editor (PRO-185)
  const openEdit = () => navigate(`/quotes/${quote.id}/edit`);


  const handleCopyLink = () => {
    navigator.clipboard?.writeText(quoteUrl);
    showToast('Lien copié dans le presse-papiers');
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Devis #${quote.id} — ${orgSettings.name || 'Billio'}`);
    const body = encodeURIComponent(
      `Bonjour,\n\nVeuillez trouver ci-joint notre devis #${quote.id} d'un montant de ${fmt(total)} F CFA.\n\nObjet : ${quote.subject}\nValide jusqu'au : ${fmtDateLong(quote.valid)}\n\nConsultez le devis en ligne :\n${quoteUrl}\n\nCordialement,\n${orgSettings.name || ''}`.trim()
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(
      `Bonjour,\n\nVoici notre devis *#${quote.id}* d'un montant de *${fmt(total)} F CFA*.\n\n📋 *${quote.subject}*\n📅 Valide jusqu'au ${fmtDateLong(quote.valid)}\n\nConsultez-le ici : ${quoteUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
    posthog.capture('quote_shared_whatsapp', { quote_id: quote.id });
  };

  const handleDownloadPDF = async () => {
    if (!paymentMethodsReady) { showToast(paymentMethodsNotReadyMessage(paymentMethodsStatus), true); return; }
    const pdfLines   = lines;
    const pdfSubject = quote.subject;
    const pdfIssued  = quote.issued;
    const pdfValid   = quote.valid;
    const pdfAmount  = total;
    try {
      const blob = await renderInvoicePdf({
        template: invoiceTemplate,
        invoice: { id: quote.id, subject: pdfSubject, client: quote.client, issued: pdfIssued, due: pdfValid, amount: pdfAmount, status: 'pending', discountPct, notes: quote.notes },
        lines: pdfLines,
        client,
        biz: orgSettings,
        title: 'Facture Proforma',
        documentKind: 'devis',
        clientLabel: 'Adressé à',
        paymentTerms: orgSettings.paymentTerms || 'Net 14 jours',
        paymentMethods,
        deliveryTerms: orgSettings.deliveryTerms || 'À convenir',
      });
      downloadBlob(blob, `devis-${quote.id.toLowerCase()}.pdf`);
      posthog.capture('quote_pdf_downloaded', { quote_id: quote.id });
    } catch (err) {
      console.error('[handleDownloadPDF] failed:', err);
      showToast('Impossible de générer le PDF. Veuillez réessayer.', true);
    }
  };

  // The invoice editor opens with the quote's data (PRO-167); it checks the mandatory mentions at issue
  const requestConvert = () => navigate(`/invoices/new?quote=${encodeURIComponent(quote.id)}`);

  return (
    <>
    <Page
      back={{ label: "Retour aux devis", onClick: () => navigate('/quotes') }}
      title={<><button className="crumb-link" onClick={() => navigate('/quotes')}>Devis</button>{' / '}<b>#{quote.id}</b></>}
      documentTitle={`Devis ${quote.id}`}
      actions={<>
        <button className="btn" onClick={handleDownloadPDF} disabled={!paymentMethodsReady}>
          <Icon name="printer" ariaHidden /> Télécharger PDF
        </button>
        {canEdit && (
          <button className="btn" onClick={openEdit}>
            <Icon name="edit" ariaHidden /> Modifier
          </button>
        )}
        {canConvert && (
          <button className="btn btn-primary" onClick={requestConvert}>
            <Icon name="arrow-right" ariaHidden />
            Créer une facture
          </button>
        )}
      </>}
    >
        <div className="detail-grid">

          {/* Quote paper */}
          <div className="paper">
            <div className="pp-top">
              <div className="pp-biz">
                <div className="pp-logo" aria-hidden="true"><BillioLogoSvg /></div>
                <div>
                  <div className="pp-biz-name">{orgSettings.name || 'Mon entreprise'}</div>
                  <div className="pp-biz-meta">
                    {[orgSettings.address, orgSettings.city, orgSettings.country].filter(Boolean).join(', ')}
                    {(orgSettings.ifu || orgSettings.rccm) && (
                      <><br />{[orgSettings.ifu && `IFU ${orgSettings.ifu}`, orgSettings.rccm && `RCCM ${orgSettings.rccm}`].filter(Boolean).join(' · ')}</>
                    )}
                    {(orgSettings.email || orgSettings.phone) && (
                      <><br />{[orgSettings.email, orgSettings.phone].filter(Boolean).join(' · ')}</>
                    )}
                  </div>
                </div>
              </div>
              <div className="pp-doc">
                <div className="pp-doc-title">Devis</div>
                <div className="pp-doc-num">#{quote.id}</div>
                <div className={`pp-status sq-${quote.status}`}>{STATUS_LABEL[quote.status]}</div>
              </div>
            </div>

            <div className="pp-parties">
              <div>
                <div className="pp-block-label">Adressé à</div>
                <div className="pp-client-name">{client.name}</div>
                <div className="pp-client-meta">{client.city}</div>
                {(client.contact || client.email || client.phone) && (
                  <div className="pp-client-meta" style={{ marginTop: 2 }}>
                    {client.contact && <div>Contact : {client.contact}</div>}
                    {client.phone   && <div>Tél : {client.phone}</div>}
                    {client.email   && <div>Email : {client.email}</div>}
                  </div>
                )}
                {(client.ifu || client.rccm || client.taxRegime) && (
                  <div className="pp-compliance-ids">
                    {client.ifu       && <span>IFU {client.ifu}</span>}
                    {client.rccm      && <span>RCCM {client.rccm}</span>}
                    {client.taxRegime && <span>{client.taxRegime}</span>}
                  </div>
                )}
              </div>
              <div>
                <div className="pp-block-label">Détails</div>
                <div className="pp-meta-grid">
                  <div className="k">Émis le</div>
                  <div className="v">{fmtDateLong(quote.issued)}</div>
                  <div className="k">Valide jusqu'au</div>
                  <div className={`v${quote.status === 'expired' ? ' due' : ''}`}>{fmtDateLong(quote.valid)}</div>
                  <div className="k">Paiement</div>
                  <div className="v">{orgSettings.paymentTerms || 'Net 14 jours'}</div>
                  <div className="k">Livraison</div>
                  <div className="v">{orgSettings.deliveryTerms || 'À convenir'}</div>
                </div>
              </div>
            </div>

            <div className="pp-subject"><span className="pp-subject-label">Objet :</span>{quote.subject}</div>

            <table className="li-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Unité</th>
                  <th className="r">Qté</th>
                  <th className="r">Prix unitaire</th>
                  <th className="r">Montant</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: '16px 0' }}>Aucune ligne</td></tr>
                ) : lines.map(li => (
                  <tr key={li.id}>
                    <td><div className="li-desc">{li.desc}</div></td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{li.unit ?? 'unité'}</td>
                    <td className="r">{li.qty}</td>
                    <td className="r">{fmt(li.price)}</td>
                    <td className="r">{fmt(li.qty * li.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pp-totals">
              <div className="pp-totals-inner">
                <div className="tot-row"><span>Sous-total</span><span className="tv">{fmt(subtotal)} F CFA</span></div>
                {discountAmt > 0 && <div className="tot-row"><span>Remise ({discountPct} %)</span><span className="tv">− {fmt(discountAmt)} F CFA</span></div>}
                {canInvoiceTVA && vatRows(sums.groups).map(r => (
                  <div key={r.key} className="tot-row"><span>{r.label}</span><span className="tv">{fmt(r.amount)} F CFA</span></div>
                ))}
                <div className="tot-row grand"><span>Total estimé</span><span className="tv">{fmt(total)} F CFA</span></div>
              </div>
            </div>
            {quote.notes && (
              <div className="pp-pay">
                <div>
                  <div className="pp-block-label">Notes et conditions</div>
                  <RichTextView doc={quote.notes} className="pp-note rich-text" />
                </div>
              </div>
            )}

            <div className="pp-foot">{orgSettings.name || 'Mon entreprise'} · Devis généré via Billio · Ce document n'est pas une facture</div>
          </div>

          {/* Rail */}
          <aside className="rail">
            <div className="rail-card">
              <div className="rail-due-label">Montant estimé</div>
              <div className="rail-due-amt tnum">
                {fmt(total)}<span className="cur">F CFA</span>
              </div>
              {quote.status === 'expired' && (
                <div className="rail-due-sub">
                  <Icon name="alert-triangle" ariaHidden />
                  Devis expiré le {fmtDateLong(quote.valid)}
                </div>
              )}
              {quote.expSoon && quote.status === 'sent' && (
                <div className="rail-due-sub" style={{ color: '#B45309' }}>
                  <Icon name="clock-pause" ariaHidden />
                  Expire bientôt
                </div>
              )}

              <div className="rail-actions">
                {canConvert && (
                  <button className="btn btn-primary btn-block" onClick={requestConvert}>
                    <Icon name="arrow-right" ariaHidden />
                    Créer une facture
                  </button>
                )}

                <div className="rail-divider" />

                <button className="btn btn-block" onClick={handleCopyLink}>
                  <Icon name="link" ariaHidden /> Copier le lien
                </button>
                <button className="btn btn-block" onClick={handleShareEmail}>
                  <Icon name="mail" ariaHidden /> Envoyer par e-mail
                </button>
                <button className="btn btn-block" onClick={handleShareWhatsApp}>
                  <Icon name="brand-whatsapp" ariaHidden /> Partager sur WhatsApp
                </button>

                <div className="rail-divider" />

                <button className="btn btn-block" onClick={handleDownloadPDF} disabled={!paymentMethodsReady}>
                  <Icon name="printer" ariaHidden /> Télécharger PDF
                </button>
              </div>
            </div>

            <div className="rail-card">
              <div className="rail-title">Statut</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span className={`status-pill sq-${quote.status}`}>{STATUS_LABEL[quote.status]}</span>
              </div>
              {(() => {
                const inv = quote.invoiceId ? invoices.find(i => i.id === quote.invoiceId) : undefined;
                return inv ? (
                  <p className="doc-link">Facture : <button type="button" className="dt-linkcell" onClick={() => navigate(`/invoices/${inv.id}`)}>{invoiceRef(inv)}</button></p>
                ) : null;
              })()}
              <div className="rail-title">Informations</div>
              <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>Émis le</span>
                  <span style={{ fontWeight: 600 }}>{fmtDateLong(quote.issued)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>Valide jusqu'au</span>
                  <span style={{ fontWeight: 600, color: quote.status === 'expired' ? '#A32D2D' : undefined }}>{fmtDateLong(quote.valid)}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
    </Page>

    </>
  );
}
