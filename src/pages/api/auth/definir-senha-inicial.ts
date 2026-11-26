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
import {
  clearPasswordFlowCookie,
  consumePasswordFlowNonce,
  verifyPasswordFlowCookie,
} from '@/lib/security/passwordFlow';
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
  sessionId?: string;
}

/**
 * Valida claims JA VERIFICADOS pelo SDK via supabase.auth.getClaims():
 * - Correspondencia estrita de sub com auth.userId;
 * - Token nao expirado (exp > now);
 * - Vinculo a uma sessao ativa (session_id nao vazio);
 * - Metodo amr recente (invite|recovery|otp <= 15m) sem autenticacao password igual ou posterior.
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
  const sessionId = claims.session_id.trim();

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

  return { ok: true, observedMethods, sessionId };
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
          'Esta rota ? restrita a sess?es recentes originadas de convite ou recupera??o. Utilize /api/auth/alterar-senha.',
      },
    });
    return;
  }

  // 2. Valida claims autenticados do JWT via getClaims() e correspondencia estrita de session_id
  const { data: claimsData, error: claimsError } = await auth.supabase.auth.getClaims();
  const claimsCheck = claimsError
    ? { ok: false, reason: 'claims_verification_failed', observedMethods: [] }
    : validateVerifiedClaimsForPasswordSetup(
        claimsData?.claims as Record<string, unknown> | undefined,
        auth.userId
      );

  if (!claimsCheck.ok || !claimsCheck.sessionId || flowCheck.sid !== claimsCheck.sessionId) {
    await auth.supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: 'auth',
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: {
        code: 'INITIAL_OR_RECOVERY_SESSION_REQUIRED',
        message:
          'Sess?o incompat?vel ou expirada para defini??o inicial/recupera??o. Solicite um novo link ou utilize /api/auth/alterar-senha.',
      },
    });
    return;
  }

  // 3. Valida politica minima da nova senha antes de consumir o nonce
  const parsed = initialPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_PASSWORD',
        message: parsed.error.issues[0]?.message ?? 'Senha n?o atende aos requisitos m?nimos.',
      },
    });
    return;
  }

  // 4. Consumo atomico de uso unico no servidor (GETDEL no Upstash) ANTES da mutacao no GoTrue.
  //    Garante no maximo 1 vencedor sob concorrencia e impede replay de copias anteriores do cookie.
  const consumed = await consumePasswordFlowNonce({
    flowId: flowCheck.fid,
    userId: auth.userId,
    sessionId: claimsCheck.sessionId,
    flow: flowCheck.flow,
  });

  if (!consumed.ok) {
    if (consumed.reason === 'store_unavailable') {
      res.setHeader('Retry-After', '60');
      res.status(503).json({
        error: {
          code: 'FLOW_PROTECTION_UNAVAILABLE',
          message: 'Servi?o de prote??o temporariamente indispon?vel. Tente novamente em instantes.',
        },
      });
      return;
    }

    clearPasswordFlowCookie(req, res);
    await auth.supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: 'auth',
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: {
        code: 'INITIAL_OR_RECOVERY_SESSION_REQUIRED',
        message:
          'Esta autoriza??o de defini??o de senha j? foi utilizada ou expirou. Solicite um novo link.',
      },
    });
    return;
  }

  // Remove o cookie no navegador imediatamente; o nonce nao e reabilitado se o GoTrue falhar/der timeout
  clearPasswordFlowCookie(req, res);

  // 5. Alteracao efetiva da senha realizada pelo Supabase Auth
  let updateError: { message?: string } | null = null;
  try {
    const result = await auth.supabase.auth.updateUser({
      password: parsed.data.newPassword,
    });
    updateError = result.error;
  } catch {
    updateError = { message: 'external_auth_error' };
  }

  if (updateError) {
    res.status(400).json({
      error: {
        code: 'PASSWORD_UPDATE_FAILED',
        message:
          'N?o foi poss?vel confirmar a atualiza??o da senha. Caso o acesso n?o funcione, solicite um novo link.',
      },
    });
    return;
  }

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
