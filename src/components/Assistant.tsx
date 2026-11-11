// The in-app assistant: a CopilotKit chat sidebar backed by Claude through the
// Worker (worker/index.ts, /api/copilotkit). It sees a snapshot of the
// business (src/lib/assistant-context.ts) and can open invoices and pages, but
// can't change any data. Loaded lazily, only when ASSISTANT_ENABLED.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { CopilotKit, CopilotSidebar, useAgentContext, useFrontendTool } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import './assistant-theme.css';
import { useApp } from '@/context/AppContext';
import { supabase, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { businessSnapshot } from '@/lib/assistant-context';
import { invoiceRef } from '@/lib/invoice-number';

/** The user's session token and the anon key, so the Worker can check who is asking. */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, 'X-Supabase-Apikey': SUPABASE_ANON_KEY } : {};
}

const PAGES = {
  tableau_de_bord: '/dashboard',
  factures: '/invoices',
  devis: '/invoices?tab=quotes',
  paiements: '/invoices?tab=payments',
  clients: '/contacts',
  produits: '/products',
  parametres: '/settings',
} as const;

function AssistantTools() {
  const navigate = useNavigate();
  const { orgSettings, plan, invoices, payments, clientsMap } = useApp();

  const snapshot = useMemo(
    () => businessSnapshot({ name: orgSettings.name, plan }, invoices, payments, clientsMap),
    [orgSettings.name, plan, invoices, payments, clientsMap],
  );
  useAgentContext({ description: "Situation de l'entreprise dans Billio (factures, encaissements, retards)", value: snapshot });

  useFrontendTool({
    name: 'ouvrir_facture',
    description: 'Ouvre une facture dans Billio à partir de son numéro (ex. FACT-2026-0012).',
    parameters: z.object({ numero: z.string().describe('Numéro de la facture') }),
    handler: async ({ numero }) => {
      const wanted = numero.trim().toLowerCase().replace(/^#/, '');
      const inv = invoices.find(i => invoiceRef(i).toLowerCase() === wanted || i.id.toLowerCase() === wanted);
      if (!inv) return `Aucune facture ${numero}.`;
      navigate(`/invoices/${inv.id}`);
      return `Facture ${invoiceRef(inv)} ouverte.`;
    },
  });

  useFrontendTool({
    name: 'ouvrir_page',
    description: 'Ouvre une page de Billio.',
    parameters: z.object({ page: z.enum(Object.keys(PAGES) as [keyof typeof PAGES, ...(keyof typeof PAGES)[]]) }),
    handler: async ({ page }) => {
      navigate(PAGES[page]);
      return `Page ${page} ouverte.`;
    },
  });

  return null;
}

export default function Assistant() {
  // Closed until the user opens it (the floating button)
  const [open, setOpen] = useState(false);
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" headers={authHeaders} showDevConsole={false} enableInspector={false}>
      <AssistantTools />
      <CopilotSidebar
        open={open}
        onOpenChange={setOpen}
        labels={{
          modalHeaderTitle: 'Assistant Billio',
          welcomeMessageText: 'Bonjour ! Posez-moi une question sur vos factures, vos clients ou vos encaissements.',
          chatInputPlaceholder: 'Ex. Qui dois-je relancer cette semaine ?',
          chatDisclaimerText: "L'assistant peut se tromper. Vérifiez les informations importantes.",
          chatToggleOpenLabel: "Ouvrir l'assistant",
          chatToggleCloseLabel: "Fermer l'assistant",
          modalHeaderCloseButtonLabel: 'Fermer',
          chatInputToolbarSendButtonLabel: 'Envoyer',
          chatInputToolbarStopButtonLabel: 'Arrêter',
          chatInputToolbarAddButtonLabel: 'Ajouter une pièce jointe',
          chatScrollToBottomLabel: 'Aller en bas',
          chatConnectingLabel: 'Connexion…',
        }}
      />
    </CopilotKit>
  );
}
