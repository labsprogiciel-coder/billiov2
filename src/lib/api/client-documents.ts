// KYB documents of clients (PRO-176): rows in client_documents and files in
// the private Storage bucket « kyb » (supabase/migrations/20261118_client_documents.sql).
// The database stamps who uploaded and who checked; the app never sends them.

import { supabase } from '@/lib/supabase';
import { MOCK_TEAM } from '@/data';
import type { ClientDocument } from '@/lib/kyb';

const MOCK = import.meta.env.VITE_MOCK_AUTH === 'true';
const BUCKET = 'kyb';

/** Largest file accepted, and the kinds (scans and PDFs). */
export const KYB_MAX_BYTES = 10 * 1024 * 1024;
export const KYB_ACCEPT = 'application/pdf,image/jpeg,image/png';

export function kybFileError(file: File): string | null {
  if (!KYB_ACCEPT.split(',').includes(file.type)) return 'Formats acceptés : PDF, JPG ou PNG.';
  if (file.size > KYB_MAX_BYTES) return 'Le fichier dépasse 10 Mo.';
  return null;
}

export function dbToClientDocument(row: Record<string, unknown>): ClientDocument {
  const s = (k: string) => (row[k] ? String(row[k]) : undefined);
  return {
    id: String(row.id), clientCode: String(row.client_code), docType: String(row.doc_type),
    filePath: String(row.file_path), fileName: String(row.file_name ?? ''),
    issuedOn: s('issued_on'), expiresOn: s('expires_on'),
    status: (row.status ?? 'pending') as ClientDocument['status'],
    uploadedByName: s('uploaded_by_name'), uploadedAt: s('uploaded_at'),
    verifiedByName: s('verified_by_name'), verifiedAt: s('verified_at'),
  };
}

// Demo mode: kept in memory, files as object URLs
const mockDocs: ClientDocument[] = [];
const mockFiles = new Map<string, string>();
const now = () => new Date().toISOString();

export async function fetchClientDocuments(orgId: string): Promise<ClientDocument[]> {
  if (MOCK) return [...mockDocs];
  const { data, error } = await supabase.from('client_documents').select('*').eq('org_id', orgId);
  if (error) throw error;
  return (data ?? []).map(r => dbToClientDocument(r as Record<string, unknown>));
}

/** Uploads a file and makes it the client's current document of that type (it then needs checking). */
export async function uploadClientDocument(
  orgId: string,
  input: { clientCode: string; docType: string; file: File; issuedOn?: string; expiresOn?: string },
): Promise<ClientDocument> {
  const err = kybFileError(input.file);
  if (err) throw new Error(err);
  const ext = (input.file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${orgId}/${input.clientCode}/${input.docType}-${crypto.randomUUID()}.${ext}`;
  if (MOCK) {
    mockFiles.set(path, URL.createObjectURL(input.file));
    const i = mockDocs.findIndex(d => d.clientCode === input.clientCode && d.docType === input.docType);
    const doc: ClientDocument = {
      id: i >= 0 ? mockDocs[i].id : crypto.randomUUID(), clientCode: input.clientCode, docType: input.docType,
      filePath: path, fileName: input.file.name, issuedOn: input.issuedOn, expiresOn: input.expiresOn,
      status: 'pending', uploadedByName: MOCK_TEAM[0].name, uploadedAt: now(),
    };
    if (i >= 0) mockDocs[i] = doc; else mockDocs.push(doc);
    return doc;
  }
  const up = await supabase.storage.from(BUCKET).upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await supabase
    .from('client_documents')
    .upsert({
      org_id: orgId, client_code: input.clientCode, doc_type: input.docType,
      file_path: path, file_name: input.file.name,
      issued_on: input.issuedOn || null, expires_on: input.expiresOn || null,
    }, { onConflict: 'org_id,client_code,doc_type' })
    .select()
    .single();
  if (error) {
    // Don't leave a file nobody points to (only admins may delete: best effort)
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return dbToClientDocument(data as Record<string, unknown>);
}

/** Vérifié / Refusé / back to « à vérifier » (admins and accountants; the database checks). */
export async function setClientDocumentStatus(orgId: string, id: string, status: ClientDocument['status']): Promise<ClientDocument> {
  if (MOCK) {
    const d = mockDocs.find(x => x.id === id);
    if (!d) throw new Error('Document introuvable');
    Object.assign(d, status === 'pending'
      ? { status, verifiedByName: undefined, verifiedAt: undefined }
      : { status, verifiedByName: MOCK_TEAM[0].name, verifiedAt: now() });
    return { ...d };
  }
  const { data, error } = await supabase.from('client_documents').update({ status }).eq('org_id', orgId).eq('id', id).select().single();
  if (error) throw error;
  const doc = dbToClientDocument(data as Record<string, unknown>);
  if (doc.status !== status) throw new Error('Seuls les administrateurs et comptables peuvent vérifier un document.');
  return doc;
}

export async function setClientDocumentDates(orgId: string, id: string, dates: { issuedOn?: string; expiresOn?: string }): Promise<ClientDocument> {
  if (MOCK) {
    const d = mockDocs.find(x => x.id === id);
    if (!d) throw new Error('Document introuvable');
    Object.assign(d, dates);
    return { ...d };
  }
  const { data, error } = await supabase.from('client_documents')
    .update({ issued_on: dates.issuedOn || null, expires_on: dates.expiresOn || null })
    .eq('org_id', orgId).eq('id', id).select().single();
  if (error) throw error;
  return dbToClientDocument(data as Record<string, unknown>);
}

/** Admins: removes the document and its file. */
export async function removeClientDocument(orgId: string, doc: ClientDocument): Promise<void> {
  if (MOCK) {
    const i = mockDocs.findIndex(x => x.id === doc.id);
    if (i >= 0) mockDocs.splice(i, 1);
    return;
  }
  const { data, error } = await supabase.from('client_documents').delete().eq('org_id', orgId).eq('id', doc.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Seuls les administrateurs peuvent supprimer un document.');
  const rm = await supabase.storage.from(BUCKET).remove([doc.filePath]);
  if (rm.error) console.warn('[removeClientDocument] file not removed:', rm.error.message);
}

/** A link to open the file for a minute (the bucket is private). */
export async function clientDocumentUrl(doc: ClientDocument): Promise<string> {
  if (MOCK) {
    const url = mockFiles.get(doc.filePath);
    if (!url) throw new Error('Fichier introuvable');
    return url;
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.filePath, 60);
  if (error || !data) throw error ?? new Error('Lien indisponible');
  return data.signedUrl;
}
