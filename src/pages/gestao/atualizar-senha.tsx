import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/gestao/AuthShell';
import { apiRequest } from '@/lib/admin/clientApi';
import { applyNoStoreHeaders } from '@/lib/security/http';
import { createSupabaseBrowserClient } from '@/lib/supabase/browserClient';
import { createUserServerClient } from '@/lib/supabase/userServerClient';

interface AtualizarSenhaProps {
  linkError: string | null;
  hasServerSession: boolean;
}

function firstParam(val: string | string[] | undefined): string | null {
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  if (Array.isArray(val) && typeof val[0] === 'string' && val[0].trim().length > 0) {
    return val[0].trim();
  }
  return null;
}

/**
 * Processa links de convite/recuperacao enviados pelo Supabase Auth no servidor sempre que
 * houver ?token_hash=&type= ou ?code= (PKCE), gravando cookies HttpOnly via SSR e
 * redirecionando imediatamente para limpar parametros sensiveis da URL.
 */
export const getServerSideProps: GetServerSideProps<AtualizarSenhaProps> = async (ctx) => {
  applyNoStoreHeaders(ctx.res);

  const errorCode = firstParam(ctx.query.error_code) ?? firstParam(ctx.query.error);
  if (errorCode) {
    const message =
      errorCode === 'otp_expired' || errorCode === 'access_denied'
        ? 'O link de convite ou recuperação expirou ou já foi utilizado. Solicite um novo link.'
        : 'Link de acesso inválido. Solicite um novo convite ou recuperação de senha.';
    return { props: { linkError: message, hasServerSession: false } };
  }

  const supabase = createUserServerClient(ctx.req, ctx.res);
  const tokenHash = firstParam(ctx.query.token_hash);
  const otpType = firstParam(ctx.query.type);
  const pkceCode = firstParam(ctx.query.code);

  if (tokenHash && (otpType === 'invite' || otpType === 'recovery' || otpType === 'email')) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
    if (error) {
      return {
        redirect: {
          destination: '/gestao/atualizar-senha?error_code=otp_expired',
          permanent: false,
        },
      };
    }
    return {
      redirect: {
        destination: '/gestao/atualizar-senha',
        permanent: false,
      },
    };
  }

  if (pkceCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(pkceCode);
    if (error) {
      return {
        redirect: {
          destination: '/gestao/atualizar-senha?error_code=otp_expired',
          permanent: false,
        },
      };
    }
    return {
      redirect: {
        destination: '/gestao/atualizar-senha',
        permanent: false,
      },
    };
  }

  const { data } = await supabase.auth.getUser();
  return {
    props: {
      linkError: null,
      hasServerSession: Boolean(data?.user?.id),
    },
  };
};

export function parseAuthHashFragment(hash: string): {
  accessToken: string | null;
  refreshToken: string | null;
  errorCode: string | null;
} {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(clean);
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    errorCode: params.get('error_code') ?? params.get('error'),
  };
}

export default function AtualizarSenhaPage({ linkError, hasServerSession }: AtualizarSenhaProps) {
  const router = useRouter();
  const [sessionReady, setSessionReady] = useState(hasServerSession);
  const [hashError, setHashError] = useState<string | null>(linkError);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsChangePasswordRoute, setNeedsChangePasswordRoute] = useState(false);

  // Fallback seguro para links implicitos (#access_token=...&refresh_token=...):
  // remove imediatamente o fragmento da URL e nao persiste tokens em localStorage/logs.
  useEffect(() => {
    const rawHash = window.location.hash;
    if (!rawHash || rawHash.length <= 1) return;

    const parsed = parseAuthHashFragment(rawHash);
    window.history.replaceState(null, '', '/gestao/atualizar-senha');

    if (parsed.errorCode) {
      const msg =
        parsed.errorCode === 'otp_expired'
          ? 'O link de convite ou recuperação expirou. Solicite um novo link.'
          : 'Não foi possível validar o link recebido.';
      Promise.resolve().then(() => setHashError(msg));
      return;
    }

    if (parsed.accessToken && parsed.refreshToken) {
      const accessToken = parsed.accessToken;
      const refreshToken = parsed.refreshToken;
      (async () => {
        try {
          const browserClient = createSupabaseBrowserClient();
          const { error } = await browserClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            setHashError('O link recebido é inválido ou expirou. Solicite um novo link.');
            return;
          }
          setSessionReady(true);
        } catch {
          setHashError('Não foi possível inicializar a sessão de redefinição.');
        }
      })();
    }
  }, []);

  const checks = {
    minLength: newPassword.length >= 12 && newPassword.length <= 128,
    lower: /[a-z]/.test(newPassword),
    upper: /[A-Z]/.test(newPassword),
    digit: /[0-9]/.test(newPassword),
    special: /[^A-Za-z0-9]/.test(newPassword),
    match: newPassword.length > 0 && newPassword === confirmPassword,
  };
  const passwordValid = Object.values(checks).every(Boolean);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !passwordValid) return;

    setSubmitting(true);
    setErrorMessage(null);
    setNeedsChangePasswordRoute(false);

    const res = await apiRequest<{ ok: boolean; flow?: string }>('/api/auth/definir-senha-inicial', {
      method: 'POST',
      body: { newPassword },
    });

    if (!res.ok) {
      if (res.errorCode === 'INITIAL_OR_RECOVERY_SESSION_REQUIRED') {
        setNeedsChangePasswordRoute(true);
      }
      setErrorMessage(res.errorMessage ?? 'Não foi possível atualizar a senha.');
      setSubmitting(false);
      return;
    }

    await router.push('/gestao/login?motivo=senha_definida');
  }

  return (
    <AuthShell
      title="Definir nova senha"
      description="Fluxo exclusivo para links recentes de convite administrativo ou recuperação de senha."
    >
      {hashError && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p>{hashError}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
            <Link href="/gestao/recuperar-senha" className="text-teal-800 underline">
              Solicitar nova recuperação
            </Link>
            <Link href="/gestao/login" className="text-slate-700 underline">
              Ir para o login
            </Link>
          </div>
        </div>
      )}

      {!hashError && !sessionReady && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        >
          Nenhuma sessão recente de convite ou recuperação foi detectada. Abra o link recebido por
          e-mail ou solicite uma nova recuperação de senha.
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <p>{errorMessage}</p>
          {needsChangePasswordRoute && (
            <p className="mt-2">
              <Link href="/gestao/minha-conta" className="font-semibold text-teal-800 underline">
                Ir para Minha conta para alterar a senha atual
              </Link>
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-slate-800">
            Nova senha
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={submitting || !sessionReady}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100"
          />
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-800">
            Confirmar nova senha
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting || !sessionReady}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100"
          />
        </div>

        <ul className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-700" aria-label="Requisitos mínimos da senha">
          <li className={checks.minLength ? 'text-emerald-700 font-medium' : ''}>
            • Mínimo de 12 caracteres (máximo 128)
          </li>
          <li className={checks.upper && checks.lower ? 'text-emerald-700 font-medium' : ''}>
            • Letras maiúsculas e minúsculas
          </li>
          <li className={checks.digit && checks.special ? 'text-emerald-700 font-medium' : ''}>
            • Pelo menos um número e um caractere especial
          </li>
          <li className={checks.match ? 'text-emerald-700 font-medium' : ''}>
            • Confirmação idêntica à nova senha
          </li>
        </ul>

        <button
          type="submit"
          disabled={submitting || !sessionReady || !passwordValid}
          className="w-full rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Salvando senha...' : 'Salvar nova senha'}
        </button>
      </form>
    </AuthShell>
  );
}