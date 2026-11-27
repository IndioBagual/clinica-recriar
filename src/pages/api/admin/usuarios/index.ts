import type { NextApiRequest, NextApiResponse } from 'next';
import { canRequestAccessLink, deriveAccountLifecycleStatus } from '@/lib/admin/accountLifecycle';
import { type AdminProfileRow, logSystemAuditSafe, requireApiAuth } from '@/lib/admin/auth';
import { createUserSchema, uuidParamSchema } from '@/lib/admin/schemas';
import { validateCsrfAndOrigin } from '@/lib/security/csrf';
import {
  applyNoStoreHeaders,
  getCanonicalSiteOrigin,
  getTrustedClientIp,
  requireJsonContentType,
  requireMethod,
} from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rateLimit';
import { createAdminServiceClient } from '@/lib/supabase/adminServiceClient';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '16kb',
    },
  },
};

export interface AuthLookupUser {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  appMetadata: Record<string, unknown>;
}

/**
 * Exige procedencia comprovavel (carimbo imutavel em app_metadata gravado apenas via SECRET_KEY)
 * e ausencia de confirmacao/uso previo antes de permitir recuperacao automatica de falha parcial.
 */
export function isLegitimatePartialProvisioningRecovery(
  user: AuthLookupUser,
  normalizedEmail: string
): boolean {
  if (user.email.trim().toLowerCase() !== normalizedEmail) return false;
  if (user.emailConfirmedAt !== null || user.lastSignInAt !== null) return false;
  if (user.appMetadata?.recriar_admin_provisioned !== true) return false;
  const actorId = user.appMetadata?.recriar_provisioning_actor_id;
  if (typeof actorId !== 'string' || !uuidParamSchema.safeParse(actorId).success) {
    return false;
  }
  return true;
}

async function findActiveAuthUserByEmail(
  admin: ReturnType<typeof createAdminServiceClient>,
  normalizedEmail: string
): Promise<AuthLookupUser | null> {
  const maxPages = 20;
  const perPage = 200;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;

    const match = data.users.find(
      (u) => typeof u.email === 'string' && u.email.trim().toLowerCase() === normalizedEmail
    );
    if (match && typeof match.email === 'string') {
      return {
        id: match.id,
        email: match.email,
        emailConfirmedAt: match.email_confirmed_at ?? null,
        lastSignInAt: match.last_sign_in_at ?? null,
        appMetadata: (match.app_metadata ?? {}) as Record<string, unknown>,
      };
    }
    if (data.users.length < perPage) return null;
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    const auth = await requireApiAuth(req, res, {
      permission: 'usuarios.manage',
      resource: 'usuarios_perfil',
    });
    if (!auth) return;

    const { data: profiles, error: profilesErr } = await auth.supabase
      .from('usuarios_perfil')
      .select(
        'id, nome, email, is_admin_principal, ativo, estado_ativacao_versao, convite_solicitado_em, email_confirmado_em, configuracao_inicial_reportada_em, primeiro_acesso_observado_em, ultimo_acesso_auth_em, desativado_em, criado_em'
      )
      .order('criado_em', { ascending: false });

    if (profilesErr) {
      res.status(500).json({ error: { code: 'LIST_USERS_FAILED', message: 'Erro ao listar usuários.' } });
      return;
    }

    const { data: perms, error: permsErr } = await auth.supabase
      .from('usuario_permissoes')
      .select('usuario_id, permissao');

    if (permsErr) {
      res.status(500).json({ error: { code: 'LIST_PERMS_FAILED', message: 'Erro ao listar permissões.' } });
      return;
    }

    const permMap = new Map<string, string[]>();
    for (const row of perms ?? []) {
      const list = permMap.get(row.usuario_id) ?? [];
      list.push(row.permissao);
      permMap.set(row.usuario_id, list);
    }

    const usuarios = ((profiles ?? []) as AdminProfileRow[]).map((p) => ({
      ...p,
      permissoes: permMap.get(p.id) ?? [],
      lifecycleStatus: deriveAccountLifecycleStatus(p),
      podeReenviarAcesso: canRequestAccessLink(p),
    }));

    res.status(200).json({ usuarios });
    return;
  }

  // POST — Criacao/convite com verificacao estrita de procedencia (correcao 7.1)
  if (!requireJsonContentType(req, res)) return;
  const csrf = validateCsrfAndOrigin(req, res);
  if (!csrf.ok) {
    await logSystemAuditSafe('ACCESS_DENIED', 'usuarios_perfil', 'negado', csrf.reason);
    return;
  }

  const auth = await requireApiAuth(req, res, {
    permission: 'usuarios.manage',
    resource: 'usuarios_perfil',
  });
  if (!auth) return;

  const rl = await enforceRateLimit(res, 'inviteLink', [auth.userId, getTrustedClientIp(req)]);
  if (!rl.allowed) return;

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'Dados de usuário inválidos.',
      },
    });
    return;
  }

  const { nome, email } = parsed.data;

  // 1. Verifica se perfil ja existe (sob RLS)
  const { data: existingProfile, error: existingErr } = await auth.supabase
    .from('usuarios_perfil')
    .select('id, ativo')
    .eq('email', email)
    .maybeSingle();

  if (existingErr) {
    res.status(500).json({ error: { code: 'CHECK_EXISTING_FAILED', message: 'Falha ao verificar e-mail.' } });
    return;
  }

  if (existingProfile) {
    res.status(409).json({
      error: {
        code: 'PROFILE_ALREADY_EXISTS',
        message: existingProfile.ativo
          ? 'Já existe uma conta administrativa ativa para este e-mail.'
          : 'Já existe uma conta administrativa desativada para este e-mail. Utilize a reativação.',
      },
    });
    return;
  }

  // 2. Verifica se ja existe conta no Supabase Auth ANTES de disparar novo convite
  const admin = createAdminServiceClient();
  const existingAuth = await findActiveAuthUserByEmail(admin, email);

  let targetUserId: string;
  let conviteSolicitado = false;
  let recoveredExistingAuthUser = false;

  if (existingAuth) {
    // Bloqueia vinculacao automatica de conta preexistente sem procedencia comprovada
    if (!isLegitimatePartialProvisioningRecovery(existingAuth, email)) {
      res.status(409).json({
        error: {
          code: 'AUTH_ACCOUNT_PREEXISTING_CONFLICT',
          message:
            'Já existe uma conta no serviço de autenticação sem procedência administrativa comprovada. A vinculação automática foi bloqueada.',
        },
      });
      return;
    }

    targetUserId = existingAuth.id;
    conviteSolicitado = false;
    recoveredExistingAuthUser = true;
  } else {
    const redirectTo = `${getCanonicalSiteOrigin()}/gestao/atualizar-senha`;
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });

    if (inviteError || !inviteData?.user?.id) {
      res.status(502).json({
        error: {
          code: 'AUTH_INVITE_FAILED',
          message: 'Não foi possível criar o convite no serviço de autenticação.',
        },
      });
      return;
    }

    targetUserId = inviteData.user.id;
    conviteSolicitado = true;

    // Carimba procedencia imutavel em app_metadata (apenas backend SECRET_KEY) para eventual recuperacao
    await admin.auth.admin
      .updateUserById(targetUserId, {
        app_metadata: {
          recriar_admin_provisioned: true,
          recriar_provisioning_actor_id: auth.userId,
          recriar_provisioned_at: new Date().toISOString(),
        },
      })
      .catch(() => {});
  }

  // 3. Cria perfil sob identidade do operador autenticado
  const { error: rpcError } = await auth.supabase.rpc('rpc_admin_create_invited_profile', {
    p_user_id: targetUserId,
    p_nome: nome,
    p_email: email,
    p_convite_solicitado: conviteSolicitado,
  });

  if (rpcError) {
    if (rpcError.code === '23505') {
      res.status(409).json({
        error: { code: 'PROFILE_ALREADY_EXISTS', message: 'Perfil administrativo já criado.' },
      });
      return;
    }

    res.status(502).json({
      error: {
        code: 'PARTIAL_CREATION_RECOVERY_REQUIRED',
        message:
          'A conta foi criada no serviço de autenticação, mas o perfil não pôde ser concluído. Reenvie a solicitação para concluir o vínculo de forma segura.',
      },
    });
    return;
  }

  res.status(201).json({
    ok: true,
    userId: targetUserId,
    conviteSolicitado,
    recoveredExistingAuthUser,
  });
}