import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { type FormEvent, useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { AdminLayout } from '@/components/gestao/AdminLayout';
import { LifecycleBadge } from '@/components/gestao/StatusBadges';
import { apiRequest, clearCsrfToken } from '@/lib/admin/clientApi';
import { type AdminViewer, formatDateTimePtBr } from '@/lib/admin/navigation';
import { requireAdminPageAuth } from '@/lib/admin/pageGuard';

interface MinhaContaProps {
  viewer: AdminViewer;
}

export const getServerSideProps: GetServerSideProps<MinhaContaProps> = async (ctx) => {
  const guard = await requireAdminPageAuth(ctx);
  if (guard.status === 'redirect') return { redirect: guard.redirect };
  if (guard.status !== 'authorized') {
    return { redirect: { destination: '/gestao/login', permanent: false } };
  }

  return { props: { viewer: guard.viewer } };
};

export default function MinhaContaPage({ viewer }: MinhaContaProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validNewPassword =
    newPassword.length >= 12 &&
    newPassword.length <= 128 &&
    /[a-z]/.test(newPassword) &&
    /[A-Z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) &&
    /[^A-Za-z0-9]/.test(newPassword) &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword;

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !validNewPassword) return;

    setSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    const res = await apiRequest<{ ok: boolean }>('/api/auth/alterar-senha', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });

    if (!res.ok) {
      setErrorMessage(res.errorMessage ?? 'Não foi possível alterar a senha.');
      setSubmitting(false);
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSuccessMessage('Senha alterada com sucesso.');
    setSubmitting(false);
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setErrorMessage(null);
    const res = await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    clearCsrfToken();
    if (!res.ok) {
      setErrorMessage(res.errorMessage ?? 'Falha ao encerrar sessão.');
      setLoggingOut(false);
      return;
    }
    await router.push('/gestao/login?motivo=logout');
  }

  return (
    <AdminLayout
      viewer={viewer}
      title="Minha conta"
      subtitle="Informações individuais do perfil e segurança de acesso"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Perfil somente leitura (sem edicao direta de email, permissoes ou ativacao) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Dados do perfil</h2>
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 sm:flex-row">
              <dt className="text-slate-500">Nome</dt>
              <dd className="font-medium text-slate-900">{viewer.nome}</dd>
            </div>
            <div className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 sm:flex-row">
              <dt className="text-slate-500">E-mail</dt>
              <dd className="font-medium text-slate-900">{viewer.email}</dd>
            </div>
            <div className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 sm:flex-row">
              <dt className="text-slate-500">Perfil</dt>
              <dd className="font-medium text-slate-900">
                {viewer.isAdminPrincipal ? 'Administrador Principal' : 'Conta Administrativa'}
              </dd>
            </div>
            <div className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 sm:flex-row">
              <dt className="text-slate-500">Permissões vigentes</dt>
              <dd className="font-medium text-slate-900">
                {viewer.permissions.length > 0 ? viewer.permissions.join(', ') : 'Nenhuma adicional'}
              </dd>
            </div>
            <div className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 sm:flex-row">
              <dt className="text-slate-500">Ciclo da conta</dt>
              <dd>
                <LifecycleBadge status={viewer.lifecycleStatus} />
              </dd>
            </div>
            <div className="flex flex-col justify-between gap-1 border-b border-slate-100 pb-3 sm:flex-row">
              <dt className="text-slate-500">Primeiro acesso observado</dt>
              <dd className="text-slate-800">{formatDateTimePtBr(viewer.primeiroAcessoObservadoEm)}</dd>
            </div>
            <div className="flex flex-col justify-between gap-1 sm:flex-row">
              <dt className="text-slate-500">Último acesso (Auth)</dt>
              <dd className="text-slate-800">{formatDateTimePtBr(viewer.ultimoAcessoAuthEm)}</dd>
            </div>
          </dl>

          <p className="mt-4 text-xs text-slate-500">
            Alterações de e-mail, permissões ou ativação não estão disponíveis diretamente nesta tela.
          </p>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {loggingOut ? 'Encerrando sessão...' : 'Encerrar todas as sessões (logout)'}
            </button>
          </div>
        </section>

        {/* Alteracao de senha exigindo senha atual */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-teal-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Alterar senha</h2>
          </div>

          {successMessage && (
            <div
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            >
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="mt-4 space-y-4" noValidate>
            <div>
              <label htmlFor="current-password" className="block text-sm font-medium text-slate-800">
                Senha atual
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <div>
              <label htmlFor="change-new-password" className="block text-sm font-medium text-slate-800">
                Nova senha
              </label>
              <input
                id="change-new-password"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <div>
              <label htmlFor="change-confirm-password" className="block text-sm font-medium text-slate-800">
                Confirmar nova senha
              </label>
              <input
                id="change-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              />
            </div>

            <p className="text-xs text-slate-500">
              A nova senha deve ter no mínimo 12 caracteres, incluindo maiúsculas, minúsculas, número,
              caractere especial e ser diferente da senha atual.
            </p>

            <button
              type="submit"
              disabled={submitting || !currentPassword || !validNewPassword}
              className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Atualizando senha...' : 'Atualizar senha'}
            </button>
          </form>
        </section>
      </div>
    </AdminLayout>
  );
}