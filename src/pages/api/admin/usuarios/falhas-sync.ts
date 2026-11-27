import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/admin/auth';
import { uuidParamSchema } from '@/lib/admin/schemas';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';

export interface FailedAuthSyncRow {
  job_id: string;
  target_user_id: string;
  target_versao: number;
  operacao: 'ban_user' | 'unban';
  tentativas: number;
  max_tentativas: number;
  ultimo_erro_codigo: string | null;
  concluido_em: string | null;
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(199).default(50),
  after_user_id: uuidParamSchema.optional(),
});

/**
 * Consulta operacional de falhas permanentes vigentes em private.auth_sync_outbox
 * exclusivamente via public.rpc_admin_list_failed_auth_syncs (identidade autenticada + usuarios.manage).
 * Nao concede acesso a audit_logs nem ao schema private.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET'])) return;

  const auth = await requireApiAuth(req, res, {
    permission: 'usuarios.manage',
    resource: 'usuarios_perfil',
  });
  if (!auth) return;

  const parsed = querySchema.safeParse({
    limit: req.query.limit,
    after_user_id: req.query.after_user_id || undefined,
  });

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_QUERY', message: 'Parâmetros de paginação inválidos.' },
    });
    return;
  }

  const { limit, after_user_id } = parsed.data;

  // Pede limit + 1 (dentro do teto 200 da RPC) para determinar hasMore sem consulta extra
  const { data, error } = await auth.supabase.rpc('rpc_admin_list_failed_auth_syncs', {
    p_limit: limit + 1,
    p_after_user_id: after_user_id ?? null,
  });

  if (error) {
    res.status(500).json({
      error: {
        code: 'FAILED_SYNC_LIST_ERROR',
        message: 'Não foi possível consultar o estado atual das falhas de sincronização.',
      },
    });
    return;
  }

  const rows = (Array.isArray(data) ? data : []) as FailedAuthSyncRow[];
  const hasMore = rows.length > limit;
  const falhas = hasMore ? rows.slice(0, limit) : rows;
  const nextAfterUserId = hasMore ? falhas[falhas.length - 1].target_user_id : null;

  res.status(200).json({
    falhas,
    hasMore,
    nextAfterUserId,
  });
}