import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { type ReactNode, useEffect, useState } from 'react';
import {
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldAlert,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, clearCsrfToken } from '@/lib/admin/clientApi';
import {
  type AdminNavItem,
  type AdminViewer,
  getAuthorizedNavigation,
} from '@/lib/admin/navigation';

interface AdminLayoutProps {
  viewer: AdminViewer;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

function NavIcon({ href }: { href: AdminNavItem['href'] }) {
  switch (href) {
    case '/gestao':
      return <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case '/gestao/usuarios':
      return <Users className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case '/gestao/auditoria':
      return <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />;
    case '/gestao/minha-conta':
      return <UserCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />;
  }
}

export function AdminLayout({ viewer, title, subtitle, children }: AdminLayoutProps) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const navItems = getAuthorizedNavigation(viewer);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const res = await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    clearCsrfToken();
    if (!res.ok) {
      setLogoutError(res.errorMessage ?? 'Falha ao encerrar sessão.');
      setLoggingOut(false);
      return;
    }
    await router.push('/gestao/login?motivo=logout');
  }

  return (
    <>
      <Head>
        <title>{`${title} | Gestão — Clínica Recriar`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <a
        href="#gestao-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-teal-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Ir para o conteúdo principal
      </a>

      <div className="min-h-screen bg-slate-50 text-slate-900 lg:flex">
        {/* Menu lateral desktop */}
        <aside
          aria-label="Navegação administrativa"
          className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white"
        >
          <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white">
              CR
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight text-slate-900">Clínica Recriar</p>
              <p className="text-xs text-slate-500">Painel /gestao</p>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-3">
            {navItems.map((item) => {
              const active = router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                    active
                      ? 'bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-600/20'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <NavIcon href={item.href} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-200 p-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="truncate text-sm font-semibold text-slate-900">{viewer.nome}</p>
              <p className="truncate text-xs text-slate-600">{viewer.email}</p>
              <span className="mt-2 inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-900">
                {viewer.isAdminPrincipal ? 'Administrador Principal' : 'Conta Administrativa'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {loggingOut ? 'Saindo...' : 'Encerrar sessão'}
            </button>
          </div>
        </aside>

        {/* Drawer mobile / tablet */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu administrativo">
            <div
              className="fixed inset-0 bg-slate-950/50"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
              <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
                <span className="text-sm font-semibold text-slate-900">Clínica Recriar — Gestão</span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Fechar menu"
                  className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 space-y-1 p-3">
                {navItems.map((item) => {
                  const active = router.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setDrawerOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                        active
                          ? 'bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-600/20'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <NavIcon href={item.href} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="border-t border-slate-200 p-4">
                <p className="truncate text-sm font-semibold text-slate-900">{viewer.nome}</p>
                <p className="truncate text-xs text-slate-600">{viewer.email}</p>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {loggingOut ? 'Saindo...' : 'Encerrar sessão'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Area principal */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Abrir menu administrativo"
                className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{title}</h1>
                {subtitle && <p className="hidden truncate text-xs text-slate-500 sm:block">{subtitle}</p>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="hidden rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:inline-flex"
              >
                Site público
              </Link>
              <Link
                href="/gestao/minha-conta"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                <UserCircle2 className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span className="max-w-[140px] truncate">{viewer.nome}</span>
              </Link>
            </div>
          </header>

          {logoutError && (
            <div role="alert" className="mx-4 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:mx-6">
              {logoutError}
            </div>
          )}

          <main id="gestao-main-content" className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}

export function AccessDeniedPanel({ requiredPermission }: { requiredPermission: string }) {
  return (
    <section
      aria-labelledby="access-denied-heading"
      className="mx-auto mt-8 max-w-xl rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm"
    >
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-800">
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 id="access-denied-heading" className="mt-4 text-xl font-semibold text-slate-900">
        Acesso negado
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Sua conta não possui a permissão <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-800">{requiredPermission}</code> necessária para acessar esta área.
      </p>
      <div className="mt-6">
        <Link
          href="/gestao"
          className="inline-flex rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Voltar à visão geral
        </Link>
      </div>
    </section>
  );
}