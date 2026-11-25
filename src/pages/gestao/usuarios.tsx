import type { GetServerSideProps } from 'next';
import { type FormEvent, useMemo, useState } from 'react';
import {
  Mail,
  Pencil,
  Power,
  RefreshCw,
  Search,
  Shield,
  UserPlus,
} from 'lucide-react';
import { AccessDeniedPanel, AdminLayout } from '@/components/gestao/AdminLayout';
import { ConfirmDialog } from '@/components/gestao/ConfirmDialog';
import { ActiveBadge, LifecycleBadge } from '@/components/gestao/StatusBadges';
import { canRequestAccessLink, deriveAccountLifecycleStatus } from '@/lib/admin/accountLifecycle';
import type { AdminProfileRow } from '@/lib/admin/auth';
import { apiRequest } from '@/lib/admin/clientApi';
import {
  type AdminViewer,
  canEditUserName,
  canManageUserPermissions,
  canToggleUserStatus,
  formatDateTimePtBr,
  type ManagedUserRow,
} from '@/lib/admin/navigation';
import { requireAdminPageAuth } from '@/lib/admin/pageGuard';
import { PHASE2_PERMISSIONS, type Phase2Permission } from '@/lib/admin/schemas';

interface UsuariosPageProps {
  viewer: AdminViewer;
  forbidden: boolean;
  initialUsers: ManagedUserRow[];
}

type StatusFilter = 'todos' | 'ativos' | 'desativados' | 'pendentes_acesso';

interface PendingAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  run: () => Promise<void>;
}

export const getServerSideProps: GetServerSideProps<UsuariosPageProps> = async (ctx) => {
  const guard = await requireAdminPageAuth(ctx, { requiredPermission: 'usuarios.manage' });
  if (guard.status === 'redirect') return { redirect: guard.redirect };
  if (guard.status === 'forbidden') {
    return { props: { viewer: guard.viewer, forbidden: true, initialUsers: [] } };
  }

  const { viewer, supabase } = guard;

  const { data: profiles } = await supabase
    .from('usuarios_perfil')
    .select(
      'id, nome, email, is_admin_principal, ativo, estado_ativacao_versao, convite_solicitado_em, email_confirmado_em, configuracao_inicial_reportada_em, primeiro_acesso_observado_em, ultimo_acesso_auth_em, desativado_em, criado_em'
    )
    .order('criado_em', { ascending: false });

  const { data: perms } = await supabase
    .from('usuario_permissoes')
    .select('usuario_id, permissao');

  const permMap = new Map<string, string[]>();
  for (const row of perms ?? []) {
    const list = permMap.get(row.usuario_id) ?? [];
    list.push(row.permissao);
    permMap.set(row.usuario_id, list);
  }

  const initialUsers: ManagedUserRow[] = ((profiles ?? []) as AdminProfileRow[]).map((p) => ({
    ...p,
    permissoes: permMap.get(p.id) ?? [],
    lifecycleStatus: deriveAccountLifecycleStatus(p),
    podeReenviarAcesso: canRequestAccessLink(p),
  }));

  return {
    props: {
      viewer,
      forbidden: false,
      initialUsers,
    },
  };
};

export default function GestaoUsuariosPage({
  viewer,
  forbidden,
  initialUsers,
}: UsuariosPageProps) {
  const [users, setUsers] = useState<ManagedUserRow[]>(initialUsers);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('todos');
  const [refreshing, setRefreshing] = useState(false);

  // Formulario de criacao
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [creating, setCreating] = useState(false);

  // Edicao de nome
  const [editingUser, setEditingUser] = useState<ManagedUserRow | null>(null);
  const [editName, setEditName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Confirmacao de acoes sensiveis
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Feedback global
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === 'ativos' && !u.ativo) return false;
      if (filter === 'desativados' && u.ativo) return false;
      if (filter === 'pendentes_acesso' && (!u.ativo || u.primeiro_acesso_observado_em !== null)) {
        return false;
      }
      if (!term) return true;
      return u.nome.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
    });
  }, [users, search, filter]);

  if (forbidden) {
    return (
      <AdminLayout viewer={viewer} title="Usuários" subtitle="Gestão de contas administrativas">
        <AccessDeniedPanel requiredPermission="usuarios.manage" />
      </AdminLayout>
    );
  }

  async function refreshUsers() {
    setRefreshing(true);
    const res = await apiRequest<{ usuarios: ManagedUserRow[] }>('/api/admin/usuarios', {
      method: 'GET',
    });
    if (res.ok && res.data?.usuarios) {
      setUsers(res.data.usuarios);
    } else if (!res.ok) {
      setErrorMsg(res.errorMessage ?? 'Não foi possível atualizar a lista de usuários.');
    }
    setRefreshing(false);
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;

    setCreating(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    const res = await apiRequest<{
      ok: boolean;
      conviteSolicitado: boolean;
      recoveredExistingAuthUser: boolean;
    }>('/api/admin/usuarios', {
      method: 'POST',
      body: { nome: newName.trim(), email: newEmail.trim() },
    });

    if (!res.ok) {
      setErrorMsg(res.errorMessage ?? 'Não foi possível criar a conta.');
      setCreating(false);
      return;
    }

    setNewName('');
    setNewEmail('');
    setCreateOpen(false);
    setCreating(false);
    setSuccessMsg(
      res.data?.recoveredExistingAuthUser
        ? 'Perfil vinculado a provisionamento anterior interrompido. Utilize "Reenviar acesso" caso precise enviar novo link.'
        : 'Perfil administrativo criado e convite solicitado.'
    );
    await refreshUsers();
  }

  async function handleSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser || savingName) return;

    setSavingName(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    const res = await apiRequest<{ ok: boolean }>(`/api/admin/usuarios/${editingUser.id}`, {
      method: 'PATCH',
      body: { nome: editName.trim() },
    });

    if (!res.ok) {
      setErrorMsg(res.errorMessage ?? 'Não foi possível atualizar o nome.');
      setSavingName(false);
      return;
    }

    setEditingUser(null);
    setSavingName(false);
    setSuccessMsg('Nome atualizado com sucesso.');
    await refreshUsers();
  }

  function requestToggleStatus(target: ManagedUserRow) {
    const nextActive = !target.ativo;
    setPendingAction({
      title: nextActive ? 'Reativar conta administrativa' : 'Desativar conta administrativa',
      description: nextActive
        ? `Confirmar a reativação da conta de ${target.nome} (${target.email})? Uma sincronização de desbloqueio será enfileirada para o Supabase Auth.`
        : `Confirmar a desativação da conta de ${target.nome} (${target.email})? O acesso ao painel /gestao será bloqueado imediatamente no servidor e no banco, e o bloqueio no Auth será enfileirado.`,
      confirmLabel: nextActive ? 'Confirmar reativação' : 'Confirmar desativação',
      tone: nextActive ? 'primary' : 'danger',
      run: async () => {
        const res = await apiRequest<{ ok: boolean; resultado: string }>(
          `/api/admin/usuarios/${target.id}/status`,
          {
            method: 'POST',
            body: { ativo: nextActive },
          }
        );
        if (!res.ok) {
          setErrorMsg(res.errorMessage ?? 'Não foi possível alterar o estado da conta.');
          return;
        }
        setSuccessMsg(
          nextActive
            ? `Conta de ${target.nome} reativada com sincronização enfileirada.`
            : `Conta de ${target.nome} desativada com sincronização enfileirada.`
        );
        await refreshUsers();
      },
    });
  }

  function requestResendAccess(target: ManagedUserRow) {
    setPendingAction({
      title: 'Solicitar novo link de acesso',
      description: `Deseja solicitar um novo link de acesso inicial para ${target.nome} (${target.email})? O sistema escolherá automaticamente entre convite ou definição de senha conforme a confirmação de e-mail no Supabase Auth.`,
      confirmLabel: 'Solicitar link',
      tone: 'primary',
      run: async () => {
        const res = await apiRequest<{ ok: boolean; fluxo: 'convite' | 'definicao_senha' }>(
          `/api/admin/usuarios/${target.id}/reenviar-acesso`,
          { method: 'POST' }
        );
        if (!res.ok) {
          setErrorMsg(res.errorMessage ?? 'Não foi possível solicitar o link de acesso.');
          return;
        }
        setSuccessMsg(
          res.data?.fluxo === 'definicao_senha'
            ? `Link de definição de senha solicitado para ${target.email} (e-mail já confirmado).`
            : `Convite solicitado novamente para ${target.email}.`
        );
        await refreshUsers();
      },
    });
  }

  function requestPermissionChange(
    target: ManagedUserRow,
    permissao: Phase2Permission,
    grant: boolean
  ) {
    setPendingAction({
      title: grant ? 'Conceder permissão administrativa' : 'Revogar permissão administrativa',
      description: grant
        ? `Confirmar a concessão da permissão "${permissao}" para ${target.nome} (${target.email})?`
        : `Confirmar a revogação da permissão "${permissao}" de ${target.nome} (${target.email})?`,
      confirmLabel: grant ? 'Conceder permissão' : 'Revogar permissão',
      tone: grant ? 'primary' : 'danger',
      run: async () => {
        const res = await apiRequest<{ ok: boolean }>(
          `/api/admin/usuarios/${target.id}/permissoes`,
          {
            method: grant ? 'POST' : 'DELETE',
            body: { permissao },
          }
        );
        if (!res.ok) {
          setErrorMsg(res.errorMessage ?? 'Não foi possível alterar a permissão.');
          return;
        }
        setSuccessMsg(
          grant
            ? `Permissão ${permissao} concedida a ${target.nome}.`
            : `Permissão ${permissao} revogada de ${target.nome}.`
        );
        await refreshUsers();
      },
    });
  }

  function requestRetryAuthSync(target: ManagedUserRow) {
    setPendingAction({
      title: 'Solicitar nova sincronização com Supabase Auth',
      description: `Enfileirar manualmente uma nova tentativa de sincronização para ${target.nome} (estado atual no banco: ${target.ativo ? 'ativo' : 'desativado'}, versão ${target.estado_ativacao_versao})?`,
      confirmLabel: 'Solicitar sincronização',
      tone: 'primary',
      run: async () => {
        const res = await apiRequest<{ ok: boolean; outboxJobId: string | null }>(
          `/api/admin/usuarios/${target.id}/retry-auth-sync`,
          { method: 'POST' }
        );
        if (!res.ok) {
          setErrorMsg(res.errorMessage ?? 'Não foi possível solicitar nova sincronização.');
          return;
        }
        setSuccessMsg(`Nova sincronização enfileirada para ${target.nome}.`);
      },
    });
  }

  async function confirmPendingAction() {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await pendingAction.run();
    } finally {
      setActionBusy(false);
      setPendingAction(null);
    }
  }

  return (
    <AdminLayout
      viewer={viewer}
      title="Usuários administrativos"
      subtitle="Contas individuais, ciclo de convite e permissões da Fase 2"
    >
      {/* Aviso de governanca: Admin Principal e status de sincronizacao */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm">
        <p>
          <strong className="text-slate-800">Governança do Administrador Principal:</strong> promoção,
          rebaixamento e transferência são exclusivos dos scripts CLI locais autorizados. A permissão{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-800">usuarios.manage</code> não
          concede acesso à auditoria nem a funcionalidades de fases futuras.
        </p>
        <p className="mt-1.5">
          <strong className="text-slate-800">Sincronização Auth:</strong> o estado atual de eventuais falhas
          permanentes por usuário não é inferido a partir de eventos históricos de auditoria; caso precise
          reprocessar manualmente uma conta, utilize a ação <em>Re-sincronizar Auth</em>.
        </p>
      </div>

      {successMsg && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {errorMsg}
        </div>
      )}

      {/* Barra de acoes e filtros */}
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <label htmlFor="search-users" className="sr-only">
              Buscar por nome ou e-mail
            </label>
            <input
              id="search-users"
              type="search"
              placeholder="Buscar por nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          </div>

          <div>
            <label htmlFor="filter-users" className="sr-only">
              Filtrar situação da conta
            </label>
            <select
              id="filter-users"
              value={filter}
              onChange={(e) => setFilter(e.target.value as StatusFilter)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 sm:w-auto"
            >
              <option value="todos">Todas as contas ({users.length})</option>
              <option value="ativos">Somente ativas</option>
              <option value="desativados">Somente desativadas</option>
              <option value="pendentes_acesso">Aguardando primeiro acesso</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={refreshUsers}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Atualizar
          </button>

          <button
            type="button"
            onClick={() => setCreateOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Nova conta administrativa
          </button>
        </div>
      </div>

      {/* Formulario de criacao de conta */}
      {createOpen && (
        <section
          aria-labelledby="create-user-heading"
          className="mb-6 rounded-2xl border border-teal-200 bg-white p-5 shadow-sm"
        >
          <h2 id="create-user-heading" className="text-base font-semibold text-slate-900">
            Criar conta administrativa individual
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            A conta será criada sem permissões administrativas adicionais. Caso necessário, o
            Administrador Principal poderá conceder permissões separadamente.
          </p>

          <form onSubmit={handleCreateUser} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="create-name" className="block text-sm font-medium text-slate-800">
                Nome completo
              </label>
              <input
                id="create-name"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={creating}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <div>
              <label htmlFor="create-email" className="block text-sm font-medium text-slate-800">
                E-mail individual
              </label>
              <input
                id="create-email"
                type="email"
                required
                maxLength={254}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={creating}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={creating || newName.trim().length < 2 || !newEmail.trim()}
                className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
              >
                {creating ? 'Criando e solicitando convite...' : 'Criar conta e enviar convite'}
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Modal inline de edicao de nome */}
      {editingUser && (
        <section
          aria-labelledby="edit-name-heading"
          className="mb-6 rounded-2xl border border-slate-300 bg-white p-5 shadow-sm"
        >
          <h2 id="edit-name-heading" className="text-base font-semibold text-slate-900">
            Editar nome de {editingUser.email}
          </h2>
          <form onSubmit={handleSaveName} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="edit-user-name" className="block text-sm font-medium text-slate-800">
                Nome
              </label>
              <input
                id="edit-user-name"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={savingName}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingName || editName.trim().length < 2}
                className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {savingName ? 'Salvando...' : 'Salvar nome'}
              </button>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                disabled={savingName}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Listagem de usuarios */}
      {filteredUsers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-800">
            Nenhum usuário encontrado para os critérios selecionados.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Ajuste a busca ou crie uma nova conta administrativa acima.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredUsers.map((user) => {
            const isSelf = user.id === viewer.id;
            const allowEditName = canEditUserName(viewer, user);
            const allowToggleStatus = canToggleUserStatus(viewer, user);
            const allowPerms = canManageUserPermissions(viewer, user);

            return (
              <article
                key={user.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{user.nome}</h3>
                      {user.is_admin_principal && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-900 px-2.5 py-0.5 text-xs font-semibold text-white">
                          <Shield className="h-3 w-3" aria-hidden="true" />
                          Administrador Principal
                        </span>
                      )}
                      {isSelf && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Você
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-slate-600">{user.email}</p>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <ActiveBadge ativo={user.ativo} />
                      <LifecycleBadge status={user.lifecycleStatus} />
                    </div>

                    {/* Marcos detalhados do ciclo de vida (sem confundir reportado com comprovado) */}
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 pt-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <dt className="inline font-medium text-slate-700">Convite solicitado: </dt>
                        <dd className="inline">{formatDateTimePtBr(user.convite_solicitado_em)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-700">E-mail confirmado: </dt>
                        <dd className="inline">{formatDateTimePtBr(user.email_confirmado_em)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-700">
                          Config. inicial reportada:{' '}
                        </dt>
                        <dd className="inline">
                          {formatDateTimePtBr(user.configuracao_inicial_reportada_em)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-700">1º acesso observado: </dt>
                        <dd className="inline">
                          {formatDateTimePtBr(user.primeiro_acesso_observado_em)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-700">Último acesso (Auth): </dt>
                        <dd className="inline">{formatDateTimePtBr(user.ultimo_acesso_auth_em)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-slate-700">Versão de ativação: </dt>
                        <dd className="inline">v{user.estado_ativacao_versao}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Acoes operacionais */}
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {allowEditName && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUser(user);
                          setEditName(user.nome);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Editar nome
                      </button>
                    )}

                    {user.podeReenviarAcesso && (
                      <button
                        type="button"
                        onClick={() => requestResendAccess(user)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        Reenviar acesso
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => requestRetryAuthSync(user)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Re-sincronizar Auth
                    </button>

                    {allowToggleStatus ? (
                      <button
                        type="button"
                        onClick={() => requestToggleStatus(user)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 ${
                          user.ativo
                            ? 'border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 focus-visible:ring-rose-600'
                            : 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus-visible:ring-emerald-600'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" aria-hidden="true" />
                        {user.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    ) : (
                      <span className="inline-flex items-center rounded-xl bg-slate-100 px-3 py-1.5 text-xs text-slate-500">
                        {isSelf
                          ? 'Auto-desativação bloqueada'
                          : 'Protegido (Admin Principal)'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Permissoes da Fase 2 */}
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">Permissões (Fase 2):</span>
                    {user.is_admin_principal ? (
                      <span className="text-xs text-slate-600">
                        Acesso integral de Fase 2 inerente ao Administrador Principal (usuarios.manage,
                        auditoria.read)
                      </span>
                    ) : (
                      PHASE2_PERMISSIONS.map((perm) => {
                        const granted = user.permissoes.includes(perm);
                        if (!allowPerms) {
                          return (
                            <span
                              key={perm}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                                granted
                                  ? 'bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-600/20'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {perm}: {granted ? 'ativa' : 'não atribuída'}
                            </span>
                          );
                        }
                        return (
                          <button
                            key={perm}
                            type="button"
                            onClick={() => requestPermissionChange(user, perm, !granted)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                              granted
                                ? 'bg-teal-700 text-white hover:bg-teal-800'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {granted ? `✓ ${perm} (revogar)` : `+ Conceder ${perm}`}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        description={pendingAction?.description ?? ''}
        confirmLabel={pendingAction?.confirmLabel ?? 'Confirmar'}
        tone={pendingAction?.tone ?? 'primary'}
        busy={actionBusy}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </AdminLayout>
  );
}