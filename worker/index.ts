// Billio's Cloudflare Worker. Static files (the app) are served by the assets
// binding; only /api/* runs this code (wrangler.toml: run_worker_first).
//
// /api/copilotkit: the CopilotKit runtime for the in-app assistant. It calls
// Anthropic with the ANTHROPIC_API_KEY secret, which never reaches the browser,
// and only answers users who are signed in to Billio (their Supabase token is
// checked first), so nobody else can spend the key.

import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2';

export interface Env {
  ASSETS: Fetcher;
  /** Secret, set on the Worker (Settings → Variables and Secrets) */
  ANTHROPIC_API_KEY: string;
  /** Public Supabase project URL (wrangler.toml [vars]) */
  SUPABASE_URL: string;
  /** Optional: Anthropic model id, e.g. claude-sonnet-5-5 */
  ASSISTANT_MODEL?: string;
}

const PROMPT = `Tu es l'assistant de gestion de Billio, une application de facturation pour les entreprises du Burkina Faso.
Tu aides le dirigeant ou le gestionnaire de l'entreprise : suivi des factures et des encaissements, clients en retard de paiement, priorités de relance, chiffre d'affaires, et questions sur les mentions obligatoires des factures (DGI, facture normalisée).
Réponds en français, de façon brève et concrète, avec les montants en F CFA (espace comme séparateur de milliers).
Appuie-toi uniquement sur les données fournies dans le contexte de l'application. Si une information manque, dis-le au lieu de l'inventer.
Tu ne peux pas modifier les données : propose plutôt l'action à faire dans Billio, ou utilise les outils mis à ta disposition (par exemple ouvrir une facture).
Pour les questions fiscales ou juridiques précises, rappelle de vérifier auprès d'un comptable ou de la DGI.`;

/** The signed-in Supabase user, or null. The browser sends its session token and the public anon key. */
async function supabaseUser(request: Request, env: Env): Promise<{ id: string } | null> {
  const auth = request.headers.get('Authorization');
  const apikey = request.headers.get('X-Supabase-Apikey');
  if (!auth?.startsWith('Bearer ') || !apikey || !env.SUPABASE_URL) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
    if (!res.ok) return null;
    const user = await res.json() as { id?: string };
    return user.id ? { id: user.id } : null;
  } catch (err) {
    // Supabase unreachable: refuse rather than fail open
    console.error('[assistant] session check failed', err);
    return null;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/copilotkit' || url.pathname.startsWith('/api/copilotkit/')) {
      if (!env.ANTHROPIC_API_KEY) return json(503, { error: 'assistant_not_configured' });
      if (request.method !== 'OPTIONS' && !(await supabaseUser(request, env))) {
        return json(401, { error: 'not_signed_in' });
      }
      // Built per request: Workers forbid random values (thread ids) at module scope
      const runtime = new CopilotRuntime({
        agents: {
          default: new BuiltInAgent({
            model: `anthropic:${env.ASSISTANT_MODEL || 'claude-sonnet-5-5'}`,
            apiKey: env.ANTHROPIC_API_KEY,
            prompt: PROMPT,
            maxSteps: 4,
          }),
        },
      });
      return createCopilotRuntimeHandler({ runtime, basePath: '/api/copilotkit' })(request);
    }

    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
