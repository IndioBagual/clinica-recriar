import type { GetServerSideProps } from 'next';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { AccessDeniedPanel, AdminLayout } from '@/components/gestao/AdminLayout';
import { AuditResultBadge, ReliabilityBadge } from '@/components/gestao/StatusBadges';
import { apiRequest } from '@/lib/admin/clientApi';
import {
  AUDIT_ACTION_LABELS,
  type AdminViewer,
  type AuditLogRow,
  formatDateTimePtBr,
} from '@/lib/admin/navigation';
import { requireAdminPageAuth } from '@/lib/admin/pageGuard';
import { AUDIT_ACTIONS } from '@/lib/admin/schemas';

interface AuditoriaPageProps {
  viewer: AdminViewer;
  forbidden: boolean;
  initialRecords: AuditLogRow[];
  initialTotal: number;
}

export const getServerSideProps: GetServerSideProps<AuditoriaPageProps> = async (ctx) => {
  const guard = await requireAdminPageAuth(ctx, { requiredPermission: 'auditoria.read' });
  if (guard.status === 'redirect') return { redirect: guard.redirect };
  if (guard.status === 'forbidden') {
    return {
      props: {
        viewer: guard.viewer,
        forbidden: true,
        initialRecords: [],
        initialTotal: 0,
      },
    };
  }

  const { viewer, supabase } = guard;
  const { data, count } = await supabase
    .from('audit_logs')
    .select(
      'id, ator_tipo, usuario_id, ator_sistema, confiabilidade, acao, recurso_entidade, recurso_id, resultado, codigo_motivo, metadados, criado_em',
      { count: 'exact' }
    )
    .order('criado_em', { ascending: false })
    .range(0, 19);

  await supabase.rpc('rpc_log_authenticated_event', {
    p_acao: 'AUDIT_LOG_VIEWED_REPORTED',
    p_recurso_entidade: 'audit_logs',
    p_pagina: 1,
    p_limite: 20,
    p_filtro_acao: null,
  });

  return {
    props: {
      viewer,
      forbidden: false,
      initialRecords: (data ?? []) as AuditLogRow[],
      initialTotal: count ?? 0,
    },
  };
};

function renderActorDescription(row: AuditLogRow): string {
  if (row.ator_tipo === 'usuario') {
    return `Usuário (${row.usuario_id ?? '—'})`;
  }
  if (row.ator_tipo === 'cli_operador_db') {
    const declared =
      typeof row.metadados?.operador_cli_declarado_id === 'string'
        ? row.metadados.operador_cli_declarado_id
        : null;
    if (declared) {
      return `Operador DB (${row.ator_sistema ?? 'cli'}) — identidade declarada no CLI: ${declared} (não comprovada pelo PostgreSQL)`;
    }
    return `Operador DB (${row.ator_sistema ?? 'cli'}) — modo emergência sem operador Auth`;
  }
  if (row.ator_tipo === 'cli_bootstrap') {
    return 'CLI Bootstrap (operador local)';
  }
  return `Sistema (${row.ator_sistema ?? 'interno'})`;
}

export default function GestaoAuditoriaPage({
  viewer,
  forbidden,
  initialRecords,
  initialTotal,
}: AuditoriaPageProps) {
  const [records, setRecords] = useState<AuditLogRow[]>(initialRecords);
  const [total, setTotal] = useState<number>(initialTotal);
  const [pagina, setPagina] = useState<number>(1);
  const [limite, setLimite] = useState<number>(20);
  const [filtroAcao, setFiltroAcao] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (forbidden) {
    return (
      <AdminLayout viewer={viewer} title="Auditoria" subtitle="Trilha de registros administrativos">
        <AccessDeniedPanel requiredPermission="auditoria.read" />
      </AdminLayout>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / limite));

  async function fetchAuditPage(nextPage: number, nextLimit: number, nextFilter: string) {
    setLoading(true);
    setErrorMsg(null);

    const params = new URLSearchParams({
      pagina: String(nextPage),
      limite: String(nextLimit),
    });
    if (nextFilter) params.set('filtro_acao', nextFilter);

    const res = await apiRequest<{
      pagina: number;
      limite: number;
      total: number;
      registros: AuditLogRow[];
    }>(`/api/admin/auditoria?${params.toString()}`, { method: 'GET' });

    if (!res.ok || !res.data) {
      setErrorMsg(res.errorMessage ?? 'Não foi possível carregar os registros de auditoria.');
      setLoading(false);
      return;
    }

    setRecords(res.data.registros);
    setTotal(res.data.total);
    setPagina(res.data.pagina);
    setLimite(res.data.limite);
    setFiltroAcao(nextFilter);
    setLoading(false);
  }

  return (
    <AdminLayout
      viewer={viewer}
      title="Auditoria administrativa"
      subtitle="Trilha somente leitura (append-only) com distinção explícita de confiabilidade"
    >
      {/* Legenda de confiabilidade */}
      <section
        aria-label="Legenda de confiabilidade dos eventos"
        className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm md:grid-cols-3"
      >
        <div>
          <ReliabilityBadge confiabilidade="verificado_banco" />
          <p className="mt-1.5">
            Fatos diretamente comprovados pelo PostgreSQL (triggers e mutações autoritativas).
          </p>
        </div>
        <div>
          <ReliabilityBadge confiabilidade="correlacionado_auth" />
          <p className="mt-1.5">
            Eventos correlacionados a timestamps reais registrados pelo Supabase Auth.
          </p>
        </div>
        <div>
          <ReliabilityBadge confiabilidade="reportado_aplicacao" />
          <p className="mt-1.5">
            Eventos comunicados pela aplicação ou workers; não equivalem a prova independente do banco.
          </p>
        </div>
      </section>

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {errorMsg}
        </div>
      )}

      {/* Filtros e paginacao superior */}
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="audit-action-filter" className="block text-xs font-semibold text-slate-700">
              Tipo de evento
            </label>
            <select
              id="audit-action-filter"
              value={filtroAcao}
              onChange={(e) => fetchAuditPage(1, limite, e.target.value)}
              disabled={loading}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            >
              <option value="">Todos os eventos ({total})</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABELS[action] ?? action}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="audit-limit" className="block text-xs font-semibold text-slate-700">
              Por página
            </label>
            <select
              id="audit-limit"
              value={limite}
              onChange={(e) => fetchAuditPage(1, Number(e.target.value), filtroAcao)}
              disabled={loading}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 sm:w-28"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fetchAuditPage(pagina, limite, filtroAcao)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Atualizar
        </button>
      </div>

      {/* Lista de registros */}
      {records.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-800">Nenhum evento encontrado.</p>
          <p className="mt-1 text-xs text-slate-500">
            Ajuste o filtro ou aguarde novas operações administrativas.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((row) => {
            const metaKeys = Object.keys(row.metadados ?? {});
            return (
              <article
                key={row.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {AUDIT_ACTION_LABELS[row.acao] ?? row.acao}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {formatDateTimePtBr(row.criado_em)} • Código: <code>{row.acao}</code>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ReliabilityBadge confiabilidade={row.confiabilidade} />
                    <AuditResultBadge resultado={row.resultado} />
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs text-slate-700 sm:grid-cols-2">
                  <div>
                    <dt className="inline font-semibold text-slate-800">Autor: </dt>
                    <dd className="inline break-all">{renderActorDescription(row)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-slate-800">Recurso: </dt>
                    <dd className="inline break-all">
                      {row.recurso_entidade}
                      {row.recurso_id ? ` (${row.recurso_id})` : ''}
                    </dd>
                  </div>
                  {row.codigo_motivo && (
                    <div>
                      <dt className="inline font-semibold text-slate-800">Motivo: </dt>
                      <dd className="inline">
                        <code className="rounded bg-slate-100 px-1 py-0.5">{row.codigo_motivo}</code>
                      </dd>
                    </div>
                  )}
                  {metaKeys.length > 0 && (
                    <div className="sm:col-span-2">
                      <dt className="inline font-semibold text-slate-800">Metadados autorizados: </dt>
                      <dd className="inline break-all font-mono text-[11px] text-slate-600">
                        {JSON.stringify(row.metadados)}
                      </dd>
                    </div>
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      )}

      {/* Paginacao inferior */}
      <nav
        aria-label="Paginação de auditoria"
        className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
      >
        <p className="text-xs text-slate-600">
          Página <strong>{pagina}</strong> de <strong>{totalPages}</strong> ({total} registros)
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || pagina <= 1}
            onClick={() => fetchAuditPage(pagina - 1, limite, filtroAcao)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Anterior
          </button>
          <button
            type="button"
            disabled={loading || pagina >= totalPages}
            onClick={() => fetchAuditPage(pagina + 1, limite, filtroAcao)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Próxima
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </nav>
    </AdminLayout>
  );
}