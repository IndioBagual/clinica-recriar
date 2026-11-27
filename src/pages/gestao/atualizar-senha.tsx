import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/gestao/AuthShell';
import { apiRequest } from '@/lib/admin/clientApi';
import { applyNoStoreHeaders } from '@/lib/security/http';
import {
  clearPasswordFlowCookie,
  isPasswordFlowNonceActive,
  issuePasswordFlowCookie,
  type PasswordSetupFlowType,
  verifyPasswordFlowCookie,
} from '@/lib/security/passwordFlow';
import { createUserServerClient } from '@/lib/supabase/userServerClient';

interface AtualizarSenhaProps {
  linkError: string | null;
  hasValidFlowSession: boolean;
  flowType: PasswordSetupFlowType | null;
  sessionEmail: string | null;
  hasRegularSessionWithoutLink: boolean;
}

function firstParam(val: string | string[] | undefined): string | null {
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  if (Array.isArray(val) && typeof val[0] === 'string' && val[0].trim().length > 0) {
    return val[0].trim();
  }
  return null;
}

/**
 * Inspeciona fragmentos de URL sem armazenar nem autenticar tokens no navegador.
 * Utilizado apenas para limpeza imediata e exibicao de erro seguro.
 */
export function inspectAuthHashFragment(hash: string): {
  hasUnexpectedTokens: boolean;
  errorCode: string | null;
} {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(clean);
  const errorCode = params.get('error_code') ?? params.get('error');
  const hasUnexpectedTokens = Boolean(params.get('access_token') || params.get('refresh_token'));
  return { hasUnexpectedTokens, errorCode };
}

/**
 * Fluxo 100% SSR via token_hash + verifyOtp (somente 'invite' e 'recovery'):
 * - Aplica Cache-Control: no-store e Referrer-Policy: no-referrer.
 * - Limpa localmente qualquer sessao anterior antes de validar um novo link.
 * - Extrai session_id verificado via getClaims(), registra nonce de uso unico no Upstash
 *   (fail-closed) e emite cookie HttpOnly assinado vinculando uid + session_id + flowId.
 * - Redireciona imediatamente (307) para remover parametros sensiveis da URL.
 */
export const getServerSideProps: GetServerSideProps<AtualizarSenhaProps> = async (ctx) => {
  applyNoStoreHeaders(ctx.res);

  const errorCode = firstParam(ctx.query.error_code) ?? firstParam(ctx.query.error);
  if (errorCode) {
    const message =
      errorCode === 'otp_expired' || errorCode === 'access_denied'
        ? 'O link de convite ou recuperação expirou ou já foi utilizado. Solicite um novo link.'
        : errorCode === 'unsupported_link_format'
          ? 'Formato de link não suportado. Solicite um novo convite ou recuperação de senha.'
          : errorCode === 'service_unavailable'
            ? 'Serviço de proteção temporariamente indisponível. Solicite um novo link em instantes.'
            : 'Link de acesso inválido. Solicite um novo convite ou recuperação de senha.';
    return {
      props: {
        linkError: message,
        hasValidFlowSession: false,
        flowType: null,
        sessionEmail: null,
        hasRegularSessionWithoutLink: false,
      },
    };
  }

  const supabase = createUserServerClient(ctx.req, ctx.res);
  const tokenHash = firstParam(ctx.query.token_hash);
  const otpType = firstParam(ctx.query.type);
  const pkceCode = firstParam(ctx.query.code);

  if (pkceCode && !tokenHash) {
    clearPasswordFlowCookie(ctx.req, ctx.res);
    return {
      redirect: {
        destination: '/gestao/atualizar-senha?error_code=unsupported_link_format',
        permanent: false,
      },
    };
  }

  if (tokenHash || otpType) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    clearPasswordFlowCookie(ctx.req, ctx.res);

    if (!tokenHash || (otpType !== 'invite' && otpType !== 'recovery')) {
      return {
        redirect: {
          destination: '/gestao/atualizar-senha?error_code=invalid_link',
          permanent: false,
        },
      };
    }

    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });

    if (error || !data?.user?.id) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      clearPasswordFlowCookie(ctx.req, ctx.res);
      return {
        redirect: {
          destination: '/gestao/atualizar-senha?error_code=otp_expired',
          permanent: false,
        },
      };
    }

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const rawSid = claimsData?.claims?.session_id;
    const sessionId = typeof rawSid === 'string' && rawSid.trim().length > 0 ? rawSid.trim() : null;

    if (claimsError || !sessionId) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      clearPasswordFlowCookie(ctx.req, ctx.res);
      return {
        redirect: {
          destination: '/gestao/atualizar-senha?error_code=otp_expired',
          permanent: false,
        },
      };
    }

    const issued = await issuePasswordFlowCookie(ctx.req, ctx.res, {
      userId: data.user.id,
      sessionId,
      flow: otpType,
    });

    if (!issued.ok) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      clearPasswordFlowCookie(ctx.req, ctx.res);
      return {
        redirect: {
          destination: '/gestao/atualizar-senha?error_code=service_unavailable',
          permanent: false,
        },
      };
    }

    return {
      redirect: {
        // Querystring explicita forca o roteador da Netlify a descartar token_hash e type da URL
        destination: '/gestao/atualizar-senha?etapa=definir_senha',
        permanent: false,
      },
    };
  }

  // Sem parametros na URL: valida sessao SSR + cookie assinado (uid + sid) + nonce ativo no servidor
  const { data } = await supabase.auth.getUser();
  const userId = data?.user?.id ?? null;

  if (!userId) {
    clearPasswordFlowCookie(ctx.req, ctx.res);
    return {
      props: {
        linkError: null,
        hasValidFlowSession: false,
        flowType: null,
        sessionEmail: null,
        hasRegularSessionWithoutLink: false,
      },
    };
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const rawSid = claimsData?.claims?.session_id;
  const sessionId = typeof rawSid === 'string' && rawSid.trim().length > 0 ? rawSid.trim() : null;

  if (!sessionId) {
    return {
      props: {
        linkError: null,
        hasValidFlowSession: false,
        flowType: null,
        sessionEmail: null,
        hasRegularSessionWithoutLink: true,
      },
    };
  }

  const flowCheck = verifyPasswordFlowCookie(ctx.req, userId, sessionId);
  if (!flowCheck.ok) {
    return {
      props: {
        linkError: null,
        hasValidFlowSession: false,
        flowType: null,
        sessionEmail: null,
        hasRegularSessionWithoutLink: true,
      },
    };
  }

  const nonceState = await isPasswordFlowNonceActive({
    flowId: flowCheck.fid,
    userId,
    sessionId,
    flow: flowCheck.flow,
  });

  if (nonceState.unavailable) {
    return {
      props: {
        linkError: 'Serviço de proteção temporariamente indisponível. Tente novamente em instantes.',
        hasValidFlowSession: false,
        flowType: null,
        sessionEmail: null,
        hasRegularSessionWithoutLink: false,
      },
    };
  }

  if (!nonceState.active) {
    clearPasswordFlowCookie(ctx.req, ctx.res);
    return {
      props: {
        linkError: null,
        hasValidFlowSession: false,
        flowType: null,
        sessionEmail: null,
        hasRegularSessionWithoutLink: true,
      },
    };
  }

  return {
    props: {
      linkError: null,
      hasValidFlowSession: true,
      flowType: flowCheck.flow,
      sessionEmail: data.user?.email ?? null,
      hasRegularSessionWithoutLink: false,
    },
  };
};

export default function AtualizarSenhaPage({
  linkError,
  hasValidFlowSession,
  flowType,
  sessionEmail,
  hasRegularSessionWithoutLink,
}: AtualizarSenhaProps) {
  const router = useRouter();
  const [fragmentError, setFragmentError] = useState<string | null>(linkError);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsChangePasswordRoute, setNeedsChangePasswordRoute] = useState(false);

  useEffect(() => {
    const rawHash = window.location.hash;
    if (!rawHash || rawHash.length <= 1) return;

    const inspected = inspectAuthHashFragment(rawHash);
    window.history.replaceState(null, '', '/gestao/atualizar-senha');

    if (inspected.errorCode) {
      const msg =
        inspected.errorCode === 'otp_expired' || inspected.errorCode === 'access_denied'
          ? 'O link de convite ou recuperação expirou. Solicite um novo link.'
          : 'Não foi possível validar o link recebido.';
      Promise.resolve().then(() => setFragmentError(msg));
      return;
    }

    if (inspected.hasUnexpectedTokens) {
      Promise.resolve().then(() =>
        setFragmentError(
          'Links com tokens no fragmento da URL não são aceitos por política de segurança. Solicite um novo link.'
        )
      );
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
  const formEnabled = hasValidFlowSession && !fragmentError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !formEnabled || !passwordValid) return;

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
      title={flowType === 'invite' ? 'Definir senha inicial' : 'Definir nova senha'}
      description="Fluxo exclusivo para links recentes de convite administrativo ou recuperação de senha."
    >
      {fragmentError && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p>{fragmentError}</p>
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

      {!fragmentError && hasValidFlowSession && sessionEmail && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900"
        >
          Link validado para a conta <strong>{sessionEmail}</strong> (
          {flowType === 'invite' ? 'convite inicial' : 'recuperação de senha'}).
        </div>
      )}

      {!fragmentError && !hasValidFlowSession && hasRegularSessionWithoutLink && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p>
            Você já está autenticado em uma sessão administrativa comum. Para alterar sua senha
            informando a senha atual, utilize a tela Minha conta.
          </p>
          <p className="mt-2">
            <Link href="/gestao/minha-conta" className="font-semibold text-teal-800 underline">
              Ir para Minha conta
            </Link>
          </p>
        </div>
      )}

      {!fragmentError && !hasValidFlowSession && !hasRegularSessionWithoutLink && (
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
            disabled={submitting || !formEnabled}
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
            disabled={submitting || !formEnabled}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100"
          />
        </div>

        <ul
          className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-700"
          aria-label="Requisitos mínimos da senha"
        >
          <li className={checks.minLength ? 'font-medium text-emerald-700' : ''}>
            • Mínimo de 12 caracteres (máximo 128)
          </li>
          <li className={checks.upper && checks.lower ? 'font-medium text-emerald-700' : ''}>
            • Letras maiúsculas e minúsculas
          </li>
          <li className={checks.digit && checks.special ? 'font-medium text-emerald-700' : ''}>
            • Pelo menos um número e um caractere especial
          </li>
          <li className={checks.match ? 'font-medium text-emerald-700' : ''}>
            • Confirmação idêntica à nova senha
          </li>
        </ul>

        <button
          type="submit"
          disabled={submitting || !formEnabled || !passwordValid}
          className="w-full rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Salvando senha...' : 'Salvar nova senha'}
        </button>
      </form>
    </AuthShell>
  );
}
