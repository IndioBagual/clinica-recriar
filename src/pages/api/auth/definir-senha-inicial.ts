import type { NextApiRequest, NextApiResponse } from 'next';
import { logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { initialPasswordSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getTrustedClientIp,
  requireJsonContentType,
  requireMethod,
} from '@/lib/security/http';
import { clearPasswordFlowCookie, verifyPasswordFlowCookie } from '@/lib/security/passwordFlow';
import { enforceRateLimit } from '@/lib/security/rateLimit';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};

const MAX_LINK_AUTH_AGE_SECONDS = 15 * 60;
const ALLOWED_LINK_METHODS = new Set(['otp', 'invite', 'recovery']);

interface JwtAmrEntry {
  method?: unknown;
  timestamp?: unknown;
}

export interface VerifiedClaimsCheck {
  ok: boolean;
  reason?: string;
  observedMethods: string[];
}

/**
 * Valida claims JA VERIFICADOS pelo SDK via `supabase.auth.getClaims()` (JWKS ou Auth API):
 * - Correspondencia estrita de `sub` com `auth.userId`;
 * - Token nao expirado (`exp > now`);
 * - Vinculo a uma sessao ativa (`session_id` nao vazio);
 * - Metodo `amr` recente (invite|recovery|otp <= 15m) sem autenticacao `password` igual ou posterior.
 *
 * IMPORTANTE: isoladamente, `otp` NAO e tratado como prova suficiente de convite/recuperacao;
 * esta validacao atua SEMPRE em conjunto com `verifyPasswordFlowCookie`, emitido apenas no SSR
 * apos `verifyOtp(token_hash, 'invite' | 'recovery')`.
 */
export function validateVerifiedClaimsForPasswordSetup(
  claims: Record<string, unknown> | null | undefined,
  expectedUserId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VerifiedClaimsCheck {
  if (!claims || typeof claims !== 'object') {
    return { ok: false, reason: 'missing_claims', observedMethods: [] };
  }

  if (typeof claims.sub !== 'string' || claims.sub !== expectedUserId) {
    return { ok: false, reason: 'sub_mismatch', observedMethods: [] };
  }

  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= nowSeconds) {
    return { ok: false, reason: 'token_expired', observedMethods: [] };
  }

  if (typeof claims.session_id !== 'string' || claims.session_id.trim().length === 0) {
    return { ok: false, reason: 'missing_session_id', observedMethods: [] };
  }

  if (!Array.isArray(claims.amr) || claims.amr.length === 0) {
    return { ok: false, reason: 'missing_amr', observedMethods: [] };
  }

  const observedMethods: string[] = [];
  let latestLinkTs = -1;
  let latestPasswordTs = -1;

  for (const rawEntry of claims.amr as JwtAmrEntry[]) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const method = typeof rawEntry.method === 'string' ? rawEntry.method.toLowerCase() : '';
    const ts =
      typeof rawEntry.timestamp === 'number' && Number.isFinite(rawEntry.timestamp)
        ? rawEntry.timestamp
        : -1;

    if (method) observedMethods.push(method);
    if (ts <= 0) continue;

    if (ALLOWED_LINK_METHODS.has(method) && ts > latestLinkTs) {
      latestLinkTs = ts;
    }
    if (method === 'password' && ts > latestPasswordTs) {
      latestPasswordTs = ts;
    }
  }

  if (latestLinkTs <= 0) {
    return { ok: false, reason: 'no_link_amr', observedMethods };
  }
  if (latestPasswordTs >= latestLinkTs) {
    return { ok: false, reason: 'password_session_detected', observedMethods };
  }
  if (nowSeconds - latestLinkTs > MAX_LINK_AUTH_AGE_SECONDS || latestLinkTs - nowSeconds > 60) {
    return { ok: false, reason: 'amr_expired', observedMethods };
  }

  return { ok: true, observedMethods };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['POST'])) return;
  if (!requireJsonContentType(req, res)) return;

  const csrf = validateCsrfAndOrigin(req, res);
  if (!csrf.ok) {
    await logSystemAuditSafe('ACCESS_DENIED', 'auth', 'negado', csrf.reason);
    return;
  }

  const auth = await requireApiAuth(req, res, { resource: 'auth' });
  if (!auth) return;

  const rl = await enforceRateLimit(res, 'adminSensitive', [auth.userId, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  // 1. Exige cookie HttpOnly assinado emitido exclusivamente pelo SSR apos verifyOtp(invite|recovery)
  const flowCheck = verifyPasswordFlowCookie(req, auth.userId);
  if (!flowCheck.ok) {
    await auth.supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: 'auth',
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: {
        code: 'INITIAL_OR_RECOVERY_SESSION_REQUIRED',
        message:
          'Esta rota é restrita a sessões recentes originadas de convite ou recuperação. Utilize /api/auth/alterar-senha.',
      },
    });
    return;
  }

  // 2. Valida claims autenticados do JWT via getClaims() (assinatura/exp/sub/session_id/amr)
  const { data: claimsData, error: claimsError } = await auth.supabase.auth.getClaims();
  const claimsCheck = claimsError
    ? { ok: false, reason: 'claims_verification_failed', observedMethods: [] }
    : validateVerifiedClaimsForPasswordSetup(
        claimsData?.claims as Record<string, unknown> | undefined,
        auth.userId
      );

  if (!claimsCheck.ok) {
    await auth.supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: 'auth',
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: {
        code: 'INITIAL_OR_RECOVERY_SESSION_REQUIRED',
        message:
          'Sessão incompatível ou expirada para definição inicial/recuperação. Solicite um novo link ou utilize /api/auth/alterar-senha.',
      },
    });
    return;
  }

  const parsed = initialPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PASSWORD',
        message: parsed.error.issues[0]?.message ?? 'Senha não atende aos requisitos mínimos.',
      },
    });
    return;
  }

  // 3. Alteracao efetiva da senha realizada pelo Supabase Auth
  const { error: updateError } = await auth.supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateError) {
    res.status(400).json({
      error: { code: 'PASSWORD_UPDATE_FAILED', message: 'Não foi possível definir a senha.' },
    });
    return;
  }

  // Consome/limpa o cookie assinado imediatamente (uso unico)
  clearPasswordFlowCookie(req, res);

  // Diferencia fluxo inicial (convite) de recuperacao de senha
  if (flowCheck.flow === 'invite' && auth.profile.primeiro_acesso_observado_em === null) {
    const { data: reportState } = await auth.supabase.rpc('rpc_report_initial_setup_completed');
    res.status(200).json({
      ok: true,
      flow: 'initial_setup',
      initialSetupReportState: reportState ?? 'reported',
    });
    return;
  }

  await auth.supabase.rpc('rpc_log_authenticated_event', {
    p_acao: 'AUTH_PASSWORD_UPDATE_REPORTED',
    p_recurso_entidade: 'auth',
  });

  res.status(200).json({
    ok: true,
    flow: 'password_recovery',
  });
}