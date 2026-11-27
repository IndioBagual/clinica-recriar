import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import {
  appendSetCookie,
  isSecureRequest,
  serializeCookie,
  type ServerRequestLike,
  type ServerResponseLike,
} from '@/lib/security/http';

function getPublicSupabaseEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY são obrigatórios.');
  }
  return { url, publishableKey };
}

/**
 * Cliente SSR autenticado para Next.js Pages Router (API Routes e getServerSideProps).
 * Opera SEMPRE com NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY e a identidade do usuario (RLS).
 */
export function createUserServerClient(req: ServerRequestLike, res: ServerResponseLike) {
  const { url, publishableKey } = getPublicSupabaseEnv();
  const secure = isSecureRequest(req);

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        const entries = Object.entries(req.cookies ?? {});
        return entries
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          const sameSiteOption =
            options?.sameSite === 'strict' ||
            options?.sameSite === 'lax' ||
            options?.sameSite === 'none' ||
            typeof options?.sameSite === 'boolean'
              ? options.sameSite
              : 'lax';

          const header = serializeCookie(name, value, {
            httpOnly: true,
            secure,
            sameSite: sameSiteOption,
            path: options?.path ?? '/',
            maxAge: options?.maxAge,
            expires: options?.expires,
          });
          appendSetCookie(res, header);
        }
      },
    },
  });
}

export function createEphemeralPublicAuthClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}