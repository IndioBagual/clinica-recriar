import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/admin/auth';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';

const querySchema = z.object({
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Visibilidade administrativa de eventos de falha permanente e retentativa manual
 * registrados em public.audit_logs (sob RLS auditoria.read).
 * Nota: nao acessa private.auth_sync_outbox diretamente; mapeamento direto por target_user_id
 * depende de RPC dedicada em migracao futura, se autorizada para a Etapa 7.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET'])) return;

  const auth = await requireApiAuth(req, res, {
    permission: 'auditoria.read',
    resource: 'audit_logs',
  });
  if (!auth) return;

  const parsed = querySchema.safeParse({
    pagina: req.query.pagina,
    limite: req.query.limite,
  });
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Parâmetros inválidos.' } });
    return;
  }

  const { pagina, limite } = parsed.data;
  const from = (pagina - 1) * limite;
  const to = from + limite - 1;

  const { data, count, error } = await auth.supabase
    .from('audit_logs')
    .select(
      'id, ator_tipo, usuario_id, ator_sistema, confiabilidade, acao, recurso_entidade, recurso_id, resultado, codigo_motivo, metadados, criado_em',
      { count: 'exact' }
    )
    .in('acao', [
      'AUTH_SYNC_FAILURE_REPORTED',
      'AUTH_SYNC_LEASE_EXHAUSTED',
      'AUTH_SYNC_MANUAL_RETRY_REQUESTED',
      'AUTH_DRIFT_REPORTED',
      'AUTH_DRIFT_CORRECTION_REPORTED',
    ])
    .order('criado_em', { ascending: false })
    .range(from, to);

  if (error) {
    res.status(500).json({ error: { code: 'READ_FAILURES_FAILED', message: 'Falha ao consultar eventos de sincronização.' } });
    return;
  }

  res.status(200).json({
    pagina,
    limite,
    total: count ?? 0,
    eventos: data ?? [],
  });
}