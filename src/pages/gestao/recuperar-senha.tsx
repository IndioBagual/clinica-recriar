import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { AuthShell } from '@/components/gestao/AuthShell';
import { apiRequest } from '@/lib/admin/clientApi';
import { applyNoStoreHeaders } from '@/lib/security/http';

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  applyNoStoreHeaders(ctx.res);
  return { props: {} };
};

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage(null);
    setFeedback(null);

    const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/recuperar-senha', {
      method: 'POST',
      body: { email: email.trim() },
    });

    if (!res.ok) {
      setErrorMessage(res.errorMessage ?? 'Não foi possível processar a solicitação.');
      setSubmitting(false);
      return;
    }

    // Mensagem neutra anti-enumeracao retornada pelo servidor
    setFeedback(
      res.data?.message ??
        'Se o e-mail estiver cadastrado e autorizado, enviaremos instruções de redefinição.'
    );
    setSubmitting(false);
  }

  return (
    <AuthShell
      title="Recuperar senha"
      description="Solicite um link seguro para redefinição da sua senha."
    >
      {feedback && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900"
        >
          {feedback}
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
          <label htmlFor="reset-email" className="block text-sm font-medium text-slate-800">
            E-mail cadastrado
          </label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="w-full rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {submitting ? 'Enviando solicitação...' : 'Solicitar redefinição'}
        </button>
      </form>

      <div className="mt-5 text-center">
        <Link href="/gestao/login" className="text-sm font-medium text-teal-800 hover:underline">
          Voltar para o login
        </Link>
      </div>
    </AuthShell>
  );
}