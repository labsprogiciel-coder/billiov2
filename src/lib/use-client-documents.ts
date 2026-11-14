// The organisation's client KYB documents (PRO-176), loaded once for the
// Contacts page: its list needs every client's status, its record the details.

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import {
  clientDocumentUrl, fetchClientDocuments, removeClientDocument, setClientDocumentDates,
  setClientDocumentStatus, uploadClientDocument,
} from '@/lib/api/client-documents';
import type { ClientDocument } from '@/lib/kyb';

export interface ClientDocumentsApi {
  docs: ClientDocument[];
  loading: boolean;
  /** Returns true when it worked; failures are shown as toasts. */
  upload: (input: { clientCode: string; docType: string; file: File; issuedOn?: string; expiresOn?: string }) => Promise<boolean>;
  setStatus: (doc: ClientDocument, status: ClientDocument['status']) => Promise<boolean>;
  setDates: (doc: ClientDocument, dates: { issuedOn?: string; expiresOn?: string }) => Promise<boolean>;
  remove: (doc: ClientDocument) => Promise<boolean>;
  open: (doc: ClientDocument) => Promise<void>;
}

export function useClientDocuments(): ClientDocumentsApi {
  const { orgId, showToast } = useApp();
  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    fetchClientDocuments(orgId)
      .then(d => { if (live) setDocs(d); })
      .catch(err => console.error('[fetchClientDocuments]', err))
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [orgId]);

  const put = (d: ClientDocument) => setDocs(prev => {
    const i = prev.findIndex(x => x.id === d.id || (x.clientCode === d.clientCode && x.docType === d.docType));
    return i >= 0 ? prev.map((x, j) => j === i ? d : x) : [...prev, d];
  });
  const fail = useCallback((err: unknown, what: string) => {
    console.error(`[clientDocuments] ${what}`, err);
    showToast(err instanceof Error && err.message ? err.message : `${what} : une erreur est survenue. Veuillez réessayer.`, true);
    return false;
  }, [showToast]);

  return {
    docs, loading,
    upload: async input => {
      try { put(await uploadClientDocument(orgId, input)); showToast('Document ajouté : à vérifier'); return true; }
      catch (err) { return fail(err, 'Envoi du document'); }
    },
    setStatus: async (doc, status) => {
      try { put(await setClientDocumentStatus(orgId, doc.id, status)); showToast(status === 'verified' ? 'Document vérifié' : status === 'rejected' ? 'Document refusé' : 'Document remis à vérifier'); return true; }
      catch (err) { return fail(err, 'Vérification'); }
    },
    setDates: async (doc, dates) => {
      try { put(await setClientDocumentDates(orgId, doc.id, dates)); return true; }
      catch (err) { return fail(err, 'Dates du document'); }
    },
    remove: async doc => {
      try { await removeClientDocument(orgId, doc); setDocs(prev => prev.filter(x => x.id !== doc.id)); showToast('Document supprimé'); return true; }
      catch (err) { return fail(err, 'Suppression'); }
    },
    open: async doc => {
      try {
        // Within the click's activation window, so pop-up blockers let it through
        const url = await clientDocumentUrl(doc);
        if (!window.open(url, '_blank', 'noopener')) window.location.assign(url);
      } catch (err) {
        fail(err, 'Ouverture du fichier');
      }
    },
  };
}
