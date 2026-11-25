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

/**
 * Inspeciona o claim `amr` do JWT da sessao JA VALIDADA no servidor por `auth.getUser()`.
 * Garante que uma sessao administrativa comum (autenticada por 'password') nao consiga
 * usar /api/auth/definir-senha-inicial para contornar a exigencia de senha atual em /api/auth/alterar-senha.
 *
 * Limite tecnico explicitamente documentado: o Supabase Auth (GoTrue) ainda permite chamadas
 * diretas a PUT /auth/v1/user com um JWT valido se Secure Password Change nao estiver habilitado
 * no projeto Auth; este controle protege a camada de API Route da aplicacao.
 */
export function hasRecentInviteOrRecoveryAmr(
  accessToken: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!accessToken || typeof accessToken !== 'string') return false;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return false;

  let payload: { amr?: unknown };
  try {
    const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
    payload = JSON.parse(decoded) as { amr?: unknown };
  } catch {
    return false;
  }

  if (!Array.isArray(payload.amr) || payload.amr.length === 0) {
    return false;
  }

  let latestLinkTs = -1;
  let latestPasswordTs = -1;

  for (const rawEntry of payload.amr as JwtAmrEntry[]) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const method = typeof rawEntry.method === 'string' ? rawEntry.method.toLowerCase() : '';
    const ts = typeof rawEntry.timestamp === 'number' && Number.isFinite(rawEntry.timestamp)
      ? rawEntry.timestamp
      : -1;

    if (ts <= 0) continue;
    if (ALLOWED_LINK_METHODS.has(method) && ts > latestLinkTs) {
      latestLinkTs = ts;
    }
    if (method === 'password' && ts > latestPasswordTs) {
      latestPasswordTs = ts;
    }
  }

  if (latestLinkTs <= 0) return false;
  // Rejeita se houve login por senha igual ou posterior ao fluxo de convite/recuperacao
  if (latestPasswordTs >= latestLinkTs) return false;
  // Rejeita links antigos (fora da janela de 15 minutos, com tolerancia de 60s para skew)
  if (nowSeconds - latestLinkTs > MAX_LINK_AUTH_AGE_SECONDS) return false;
  if (latestLinkTs - nowSeconds > 60) return false;

  return true;
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

  // Sessao ja validada via auth.getUser(); inspeciona amr para barrar sessoes comuns por senha
  const { data: sessionData } = await auth.supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!hasRecentInviteOrRecoveryAmr(accessToken)) {
    await auth.supabase.rpc('rpc_log_authenticated_event', {
      p_acao: 'ACCESS_DENIED',
      p_recurso_entidade: 'auth',
      p_codigo_motivo: 'sem_permissao',
    });
    res.status(403).json({
      error: {
        code: 'INITIAL_OR_RECOVERY_SESSION_REQUIRED',
        message:
          'Esta rota é restrita a sessões recentes de convite ou recuperação. Utilize /api/auth/alterar-senha informando a senha atual.',
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

  // Alteracao efetiva da senha realizada pelo Supabase Auth
  const { error: updateError } = await auth.supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateError) {
    res.status(400).json({
      error: { code: 'PASSWORD_UPDATE_FAILED', message: 'Não foi possível definir a senha.' },
    });
    return;
  }

  // Diferencia fluxo inicial (primeiro_acesso_observado_em === null) de recuperacao de senha
  if (auth.profile.primeiro_acesso_observado_em === null) {
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