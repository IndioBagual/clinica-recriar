import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText, ShieldCheck, UserCircle2, Users } from 'lucide-react';
import { AdminLayout } from '@/components/gestao/AdminLayout';
import { AuditResultBadge, LifecycleBadge, ReliabilityBadge } from '@/components/gestao/StatusBadges';
import {
  AUDIT_ACTION_LABELS,
  type AdminViewer,
  type AuditLogRow,
  formatDateTimePtBr,
  hasViewerPermission,
} from '@/lib/admin/navigation';
import { requireAdminPageAuth } from '@/lib/admin/pageGuard';

interface UserSummaryMetrics {
  total: number;
  ativos: number;
  desativados: number;
  aguardandoPrimeiroAcesso: number;
}

interface AuditSummaryMetrics {
  totalRegistros: number;
  recentes: AuditLogRow[];
}

interface GestaoHomeProps {
  viewer: AdminViewer;
  userMetrics: UserSummaryMetrics | null;
  auditMetrics: AuditSummaryMetrics | null;
}

export const getServerSideProps: GetServerSideProps<GestaoHomeProps> = async (ctx) => {
  const guard = await requireAdminPageAuth(ctx);
  if (guard.status === 'redirect') return { redirect: guard.redirect };
  if (guard.status !== 'authorized') {
    return { redirect: { destination: '/gestao/login', permanent: false } };
  }

  const { viewer, supabase } = guard;
  let userMetrics: UserSummaryMetrics | null = null;
  let auditMetrics: AuditSummaryMetrics | null = null;

  // Consulta indicadores ESTRITAMENTE conforme permissoes do usuario e via RLS (nunca service_role)
  if (hasViewerPermission(viewer, 'usuarios.manage')) {
    const { data: rows } = await supabase
      .from('usuarios_perfil')
      .select('ativo, primeiro_acesso_observado_em');

    if (Array.isArray(rows)) {
      const ativos = rows.filter((r) => r.ativo === true).length;
      const aguardandoPrimeiroAcesso = rows.filter(
        (r) => r.ativo === true && r.primeiro_acesso_observado_em === null
      ).length;
      userMetrics = {
        total: rows.length,
        ativos,
        desativados: rows.length - ativos,
        aguardandoPrimeiroAcesso,
      };
    }
  }

  if (hasViewerPermission(viewer, 'auditoria.read')) {
    const { data: logs, count } = await supabase
      .from('audit_logs')
      .select(
        'id, ator_tipo, usuario_id, ator_sistema, confiabilidade, acao, recurso_entidade, recurso_id, resultado, codigo_motivo, metadados, criado_em',
        { count: 'exact' }
      )
      .order('criado_em', { ascending: false })
      .limit(5);

    auditMetrics = {
      totalRegistros: count ?? 0,
      recentes: (logs ?? []) as AuditLogRow[],
    };
  }

  return {
    props: {
      viewer,
      userMetrics,
      auditMetrics,
    },
  };
};

export default function GestaoDashboardPage({
  viewer,
  userMetrics,
  auditMetrics,
}: GestaoHomeProps) {
  const canManageUsers = hasViewerPermission(viewer, 'usuarios.manage');
  const canReadAudit = hasViewerPermission(viewer, 'auditoria.read');

  return (
    <AdminLayout
      viewer={viewer}
      title="Visão geral"
      subtitle="Painel administrativo da Clínica Recriar — Fase 2"
    >
      {/* Cartao da propria conta */}
      <section
        aria-labelledby="account-summary-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">
              Sessão autenticada
            </p>
            <h2 id="account-summary-heading" className="mt-1 text-xl font-semibold text-slate-900">
              Olá, {viewer.nome}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{viewer.email}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <LifecycleBadge status={viewer.lifecycleStatus} />
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                <ShieldCheck className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                {viewer.isAdminPrincipal
                  ? 'Administrador Principal'
                  : viewer.permissions.length > 0
                    ? `Permissões: ${viewer.permissions.join(', ')}`
                    : 'Sem permissões administrativas adicionais'}
              </span>
            </div>
          </div>

          <Link
            href="/gestao/minha-conta"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            <UserCircle2 className="h-4 w-4 text-teal-700" aria-hidden="true" />
            Minha conta
          </Link>
        </div>
      </section>

      {/* Indicadores de usuarios — exibidos SOMENTE para usuarios.manage */}
      {canManageUsers && userMetrics && (
        <section aria-labelledby="users-kpi-heading" className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="users-kpi-heading" className="text-base font-semibold text-slate-900">
              Contas administrativas
            </h2>
            <Link
              href="/gestao/usuarios"
              className="inline-flex items-center gap-1 text-sm font-semibold text-teal-800 hover:underline"
            >
              Gerenciar usuários
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Total de perfis</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{userMetrics.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Contas ativas</p>
              <p className="mt-2 text-3xl font-bold text-emerald-700">{userMetrics.ativos}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Contas desativadas</p>
              <p className="mt-2 text-3xl font-bold text-rose-700">{userMetrics.desativados}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500">Aguardando primeiro acesso</p>
              <p className="mt-2 text-3xl font-bold text-amber-800">
                {userMetrics.aguardandoPrimeiroAcesso}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Resumo de auditoria — exibido SOMENTE para auditoria.read */}
      {canReadAudit && auditMetrics && (
        <section
          aria-labelledby="audit-summary-heading"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="audit-summary-heading" className="text-base font-semibold text-slate-900">
                Auditoria recente
              </h2>
              <p className="text-xs text-slate-500">
                Total registrado no banco: <strong>{auditMetrics.totalRegistros}</strong> eventos
              </p>
            </div>
            <Link
              href="/gestao/auditoria"
              className="inline-flex items-center gap-1 text-sm font-semibold text-teal-800 hover:underline"
            >
              Ver trilha completa
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {auditMetrics.recentes.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Nenhum evento de auditoria registrado até o momento.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {auditMetrics.recentes.map((ev) => (
                <li key={ev.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {AUDIT_ACTION_LABELS[ev.acao] ?? ev.acao}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTimePtBr(ev.criado_em)} • {ev.recurso_entidade}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ReliabilityBadge confiabilidade={ev.confiabilidade} />
                    <AuditResultBadge resultado={ev.resultado} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Estado explicito para usuario ativo sem permissoes administrativas adicionais */}
      {!canManageUsers && !canReadAudit && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Nenhuma permissão administrativa adicional atribuída
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Sua conta está ativa para acesso individual. Caso necessite gerenciar usuários ou consultar
                registros de auditoria, solicite a atribuição explícita ao Administrador Principal.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Atalhos autorizados */}
      {(canManageUsers || canReadAudit) && (
        <section aria-label="Atalhos disponíveis" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {canManageUsers && (
            <Link
              href="/gestao/usuarios"
              className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <Users className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Gestão de usuários</p>
                  <p className="text-xs text-slate-500">Criar contas, convites, status e permissões</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-teal-700" aria-hidden="true" />
            </Link>
          )}
          {canReadAudit && (
            <Link
              href="/gestao/auditoria"
              className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-300"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Auditoria administrativa</p>
                  <p className="text-xs text-slate-500">Consultar eventos e nível de confiabilidade</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-teal-700" aria-hidden="true" />
            </Link>
          )}
        </section>
      )}
    </AdminLayout>
  );
}