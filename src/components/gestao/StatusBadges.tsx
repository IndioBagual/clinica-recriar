import type { AccountLifecycleStatus } from '@/lib/admin/accountLifecycle';
import type { AuditLogRow } from '@/lib/admin/navigation';

export function ActiveBadge({ ativo }: { ativo: boolean }) {
  return ativo ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
      Conta ativa
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 ring-1 ring-inset ring-rose-600/20">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-600" aria-hidden="true" />
      Conta desativada
    </span>
  );
}

const LIFECYCLE_STYLES: Record<
  AccountLifecycleStatus,
  { label: string; className: string; detail?: string }
> = {
  desativada: {
    label: 'Desativada',
    className: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  },
  ativa_acesso_observado: {
    label: 'Primeiro acesso observado',
    className: 'bg-teal-50 text-teal-800 ring-teal-600/20',
  },
  configuracao_inicial_reportada: {
    label: 'Configuração inicial reportada',
    className: 'bg-amber-50 text-amber-900 ring-amber-600/25',
    detail: 'Reportado pela aplicação; não comprova alteração de senha de forma independente.',
  },
  email_confirmado_sem_acesso: {
    label: 'E-mail confirmado (sem acesso)',
    className: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  },
  convite_solicitado: {
    label: 'Convite solicitado',
    className: 'bg-indigo-50 text-indigo-800 ring-indigo-600/20',
  },
  perfil_criado_sem_convite: {
    label: 'Perfil criado (sem convite)',
    className: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  },
};

export function LifecycleBadge({ status }: { status: AccountLifecycleStatus }) {
  const cfg = LIFECYCLE_STYLES[status];
  return (
    <span
      title={cfg.detail}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export function ReliabilityBadge({
  confiabilidade,
}: {
  confiabilidade: AuditLogRow['confiabilidade'];
}) {
  if (confiabilidade === 'verificado_banco') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
        Verificado pelo banco
      </span>
    );
  }
  if (confiabilidade === 'correlacionado_auth') {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-600/20">
        Correlacionado ao Auth
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-600/25">
      Reportado pela aplicação
    </span>
  );
}

export function AuditResultBadge({ resultado }: { resultado: AuditLogRow['resultado'] }) {
  if (resultado === 'sucesso') {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Sucesso
      </span>
    );
  }
  if (resultado === 'negado') {
    return (
      <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
        Negado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">
      Erro
    </span>
  );
}