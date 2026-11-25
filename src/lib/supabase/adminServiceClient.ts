import { createClient } from '@supabase/supabase-js';

/**
 * Cliente privilegiado EXCLUSIVO DE BACKEND (SUPABASE_SECRET_KEY).
 * - Nunca pode ser importado no navegador.
 * - Nunca compartilha cookies ou sessoes de usuarios.
 * - Nao possui acesso direto as 6 tabelas administrativas (REVOKE ALL no banco);
 *   destina-se apenas a Admin API do Auth e RPCs de sistema explicitamente autorizadas.
 */
export function createAdminServiceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('adminServiceClient é restrito ao ambiente de servidor.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error('Configuração privilegiada do Supabase ausente no servidor.');
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
