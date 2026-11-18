import { useState } from 'react';
import { usePermissions } from '@/lib/use-permissions';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import ConfirmModal from '@/components/ConfirmModal';
import SendDocumentDialog from '@/components/SendDocumentDialog';
import { PageSkeleton } from '@/components/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { createQuote, removeQuote, nextQuoteId } from '@/lib/api/quotes';
import { quoteMessage } from '@/lib/document-messages';
import { createActivity } from '@/lib/api/activities';
import { contactValue } from '@/lib/share-links';
import { saveLineItems, fetchLineItems } from '@/lib/api/line-items';
import type { Activity } from '@/lib/schemas';
import Page from '@/components/Page';
import QuoteList from '@/components/sales/QuoteList';
import { useCommandIntent } from '@/lib/command-intent';

/** Devis: the list (PRO-165). Quotes are written on their own page, /quotes/new (PRO-185). */
export default function QuotesPage() {
  const { writable, deletable } = usePermissions();
  const { showToast, quotes, setQuotes, setActivity, clientsMap, orgSettings, orgId, loading } = useApp();
  const [sendQuote, setSendQuote] = useState<{ id: string; kind: 'send' | 'reminder' } | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const navigate = useNavigate();

  // From the command box (PRO-162): a new quote, maybe for a client
  useCommandIntent(intent => {
    if (intent.command !== 'new-quote' || !writable) return false;
    navigate(intent.client ? `/quotes/new?client=${encodeURIComponent(intent.client)}` : '/quotes/new', { replace: true });
    return 'navigated';
  }, !loading);

  function sendReminder(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setSendQuote({ id, kind: 'reminder' });
  }

  // A new draft with the same client, subject and lines, dated today
  async function duplicateQuote(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    const quote = quotes.find(q => q.id === id);
    if (!quote || duplicating) return;
    setDuplicating(id);
    try {
      const lines = await fetchLineItems(orgId, { quoteId: id });
      const validDays = Math.max(1, Math.round((Date.parse(quote.valid) - Date.parse(quote.issued)) / 86_400_000)) || 14;
      const issued = new Date().toISOString().slice(0, 10);
      const valid = new Date(Date.now() + validDays * 86_400_000).toISOString().slice(0, 10);
      const newId = await nextQuoteId(orgId);
      const created = await createQuote(orgId, { id: newId, subject: quote.subject, client: quote.client, issued, valid, amount: quote.amount, status: 'draft', discountPct: quote.discountPct, notes: quote.notes });
      try {
        await saveLineItems(orgId, lines, { quoteId: newId });
      } catch (err) {
        await removeQuote(orgId, newId).catch(e2 => console.error('[rollback] removeQuote failed:', e2));
        throw err;
      }
      setQuotes(prev => prev.some(q => q.id === newId) ? prev : [created, ...prev]);
      showToast(`Brouillon ${newId} créé à partir de ${id}`);
      navigate(`/quotes/${newId}`);
    } catch (err) {
      console.error('[duplicateQuote] failed:', err);
      showToast('Impossible de dupliquer le devis. Veuillez réessayer.', true);
    } finally {
      setDuplicating(null);
    }
  }

  function handleDelete(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setDeleteId(id);
  }

  async function confirmDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    const previous = quotes;
    setQuotes(prev => prev.filter(q => q.id !== id));
    try {
      await removeQuote(orgId, id);
      showToast(`Devis ${id} supprimé`);
    } catch (err) {
      console.error('[removeQuote] failed:', err);
      setQuotes(previous);
      showToast('Erreur lors de la suppression du devis. Veuillez réessayer.', true);
    }
  }

  if (loading) return <PageSkeleton title="Devis" subtitle="Estimations envoyées avant facturation" metrics={0} rows={6} />;

  return (
    <>
      <Page
        title="Devis"
        subtitle="Estimations envoyées avant facturation"
        actions={writable && (
          <button className="btn btn-primary" onClick={() => navigate('/quotes/new')}>
            <Icon name="plus" size={16} />
            Nouveau devis
          </button>
        )}
      >
        <QuoteList
          writable={writable}
          deletable={deletable}
          onOpen={id => navigate(`/quotes/${id}`)}
          onEdit={id => navigate(`/quotes/${id}/edit`)}
          onConvert={q => navigate(`/invoices/new?quote=${encodeURIComponent(q.id)}`)}
          onRemind={id => sendReminder(id)}
          onDuplicate={id => void duplicateQuote(id)}
          onDelete={id => handleDelete(id)}
          duplicating={duplicating !== null}
        />
      </Page>
      {deleteId && (
        <ConfirmModal
          title="Supprimer le devis"
          body={`Supprimer le devis ${deleteId} ? Cette action est irréversible.`}
          confirmLabel="Supprimer le devis"
          onConfirm={confirmDelete}
          onClose={() => setDeleteId(null)}
        />
      )}
      {sendQuote && (() => {
        const q = quotes.find(x => x.id === sendQuote.id);
        if (!q) return null;
        const cl = clientsMap[q.client];
        const clientName = cl?.name ?? q.client;
        const msg = quoteMessage(sendQuote.kind, { quoteId: q.id, clientName, orgName: orgSettings.name, amount: q.amount, validUntil: q.valid });
        return (
          <SendDocumentDialog
            title={sendQuote.kind === 'reminder' ? `Relancer ${clientName}` : `Envoyer le devis ${q.id}`}
            recipientName={clientName}
            email={contactValue(cl?.email)}
            phone={contactValue(cl?.phone)}
            subject={msg.subject}
            message={msg.message}
            onSent={channel => {
              if (channel === 'copy') return;
              // Opening the email app or WhatsApp doesn't mean the message went out
              const via = channel === 'email' ? 'par email' : 'par WhatsApp';
              const parts = sendQuote.kind === 'reminder'
                ? [{ text: `Relance préparée ${via} pour le devis ` }, { text: q.id, bold: true as const }]
                : [{ text: 'Devis ' }, { text: q.id, bold: true as const }, { text: ` préparé ${via} pour ` }, { text: clientName, bold: true as const }];
              const entry: Activity = { kind: 'sent', parts, time: "À l'instant" };
              setActivity(prev => [entry, ...prev]);
              createActivity(orgId, { kind: 'sent', parts }).catch(err => {
                console.error('[createActivity] failed:', err);
                setActivity(prev => prev.filter(a => a !== entry));
                showToast('L\'envoi n\'a pas pu être enregistré dans l\'historique.', true);
              });
              setSendQuote(null);
            }}
            onClose={() => setSendQuote(null)}
          />
        );
      })()}
    </>
  );
}
