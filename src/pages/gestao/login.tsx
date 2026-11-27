import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { type FormEvent, useState } from 'react';
import { AuthShell } from '@/components/gestao/AuthShell';
import { apiRequest } from '@/lib/admin/clientApi';
import { redirectIfAuthenticatedAdmin } from '@/lib/admin/pageGuard';
import { sanitizeInternalRedirect } from '@/lib/security/http';

interface LoginPageProps {
  motivo: string | null;
  nextPath: string;
}

const MOTIVO_BANNERS: Record<string, { tone: 'info' | 'warn'; text: string }> = {
  sessao_expirada: {
    tone: 'warn',
    text: 'Sua sessão expirou ou foi encerrada. Faça login novamente para continuar.',
  },
  acesso_indisponivel: {
    tone: 'warn',
    text: 'Esta conta não está autorizada ou foi desativada para acesso ao painel.',
  },
  logout: {
    tone: 'info',
    text: 'Sessão encerrada com segurança.',
  },
  senha_definida: {
    tone: 'info',
    text: 'Senha atualizada com sucesso. Entre com seu e-mail e sua nova senha.',
  },
};

export const getServerSideProps: GetServerSideProps<LoginPageProps> = async (ctx) => {
  const redirect = await redirectIfAuthenticatedAdmin(ctx);
  if (redirect) return { redirect };

  const rawMotivo = Array.isArray(ctx.query.motivo) ? ctx.query.motivo[0] : ctx.query.motivo;
  const rawNext = Array.isArray(ctx.query.next) ? ctx.query.next[0] : ctx.query.next;

  return {
    props: {
      motivo: rawMotivo && rawMotivo in MOTIVO_BANNERS ? rawMotivo : null,
      nextPath: sanitizeInternalRedirect(rawNext, '/gestao'),
    },
  };
};

export default function GestaoLoginPage({ motivo, nextPath }: LoginPageProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const banner = motivo ? MOTIVO_BANNERS[motivo] : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    const res = await apiRequest<{ ok: boolean }>('/api/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password },
    });

    if (!res.ok) {
      setErrorMessage(res.errorMessage ?? 'E-mail ou senha inválidos.');
      setSubmitting(false);
      return;
    }

    await router.push(nextPath);
  }

  return (
    <AuthShell
      title="Acesso à Gestão"
      description="Informe suas credenciais administrativas individuais."
    >
      {banner && (
        <div
          role="status"
          className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
            banner.tone === 'warn'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-teal-200 bg-teal-50 text-teal-900'
          }`}
        >
          {banner.text}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-800">
            E-mail institucional
          </label>
          <input
            id="login-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-800">
              Senha
            </label>
            <Link
              href="/gestao/recuperar-senha"
              className="text-xs font-medium text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              Esqueci minha senha
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          className="w-full rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Verificando credenciais...' : 'Entrar no painel'}
        </button>
      </form>
    </AuthShell>
  );
}