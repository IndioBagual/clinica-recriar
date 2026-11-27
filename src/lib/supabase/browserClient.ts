import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente destinado ao navegador (quando necessario).
 * Utiliza EXCLUSIVAMENTE a chave publicavel (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error('Configuração pública do Supabase ausente.');
  }

  return createBrowserClient(url, publishableKey);
}