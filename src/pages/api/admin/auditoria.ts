import type { NextApiRequest, NextApiResponse } from 'next';
import { requireApiAuth } from '@/lib/admin/auth';
import { auditQuerySchema } from '@/lib/admin/schemas';
import { applyNoStoreHeaders, requireMethod } from '@/lib/security/http';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  applyNoStoreHeaders(res);
  if (!requireMethod(req, res, ['GET'])) return;

  const auth = await requireApiAuth(req, res, {
    permission: 'auditoria.read',
    resource: 'audit_logs',
  });
  if (!auth) return;

  const parsed = auditQuerySchema.safeParse({
    pagina: req.query.pagina,
    limite: req.query.limite,
    filtro_acao: req.query.filtro_acao || undefined,
  });

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'INVALID_QUERY', message: 'Parâmetros de paginação ou filtro inválidos.' },
    });
    return;
  }

  const { pagina, limite, filtro_acao } = parsed.data;
  const from = (pagina - 1) * limite;
  const to = from + limite - 1;

  let query = auth.supabase
    .from('audit_logs')
    .select(
      'id, ator_tipo, usuario_id, ator_sistema, confiabilidade, acao, recurso_entidade, recurso_id, resultado, codigo_motivo, metadados, criado_em',
      { count: 'exact' }
    )
    .order('criado_em', { ascending: false })
    .range(from, to);

  if (filtro_acao) {
    query = query.eq('acao', filtro_acao);
  }

  const { data, count, error } = await query;
  if (error) {
    res.status(500).json({ error: { code: 'AUDIT_READ_FAILED', message: 'Falha ao consultar auditoria.' } });
    return;
  }

  await auth.supabase.rpc('rpc_log_authenticated_event', {
    p_acao: 'AUDIT_LOG_VIEWED_REPORTED',
    p_recurso_entidade: 'audit_logs',
    p_pagina: pagina,
    p_limite: limite,
    p_filtro_acao: filtro_acao ?? null,
  });

  res.status(200).json({
    pagina,
    limite,
    total: count ?? 0,
    registros: data ?? [],
  });
}