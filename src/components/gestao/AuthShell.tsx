import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <>
      <Head>
        <title>{`${title} | Gestão — Clínica Recriar`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-700 text-base font-bold text-white shadow-sm">
              CR
            </span>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-teal-800">
              Clínica Recriar • Área Restrita
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            <p className="mt-1.5 text-sm text-slate-600">{description}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {children}
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Acesso exclusivo para contas individuais autorizadas pela direção.{' '}
            <Link href="/" className="font-medium text-teal-800 underline hover:text-teal-900">
              Retornar ao site público
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}