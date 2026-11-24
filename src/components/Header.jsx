import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Menu, X, CalendarCheck } from 'lucide-react';
import { SITE_CONFIG, criarLinkWhatsapp } from '../config/site';
import { resolverImagem } from '../lib/midia';

export default function Header() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();
  const whatsappLink = criarLinkWhatsapp();

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isActive = (href) => {
    if (href === '/') return router.pathname === '/';
    return router.pathname === href || router.pathname.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-sand-dark/60 bg-cream/95 backdrop-blur-md">
      <div className="container mx-auto flex h-20 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 shrink-0"
          aria-label="Página inicial da Clínica Recriar"
        >
          <Image
            src={resolverImagem('/img/Logo recriar.png')}
            alt="Logotipo Clínica Recriar"
            width={156}
            height={48}
            priority
            className="h-11 w-auto object-contain"
          />
        </Link>

        <nav
          aria-label="Navegação principal"
          className="hidden xl:flex items-center gap-6"
        >
          {SITE_CONFIG.navPrincipal.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? 'text-brand font-semibold'
                  : 'text-earth-body hover:text-brand'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden xl:flex items-center gap-3">
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-terracotta px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-terracotta-dark"
          >
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
            Agendar Consulta
          </a>
        </div>

        <button
          type="button"
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="menu-mobile"
          aria-label={isMobileMenuOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
          className="inline-flex xl:hidden items-center justify-center rounded-xl p-2.5 text-brand-dark hover:bg-sage-100 transition-colors"
        >
          {isMobileMenuOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Menu className="h-6 w-6" aria-hidden="true" />
          )}
        </button>
      </div>

      {isMobileMenuOpen && (
        <div
          id="menu-mobile"
          className="border-t border-sand-dark/60 bg-cream shadow-card xl:hidden"
        >
          <nav
            aria-label="Navegação móvel"
            className="container mx-auto flex flex-col gap-1 px-4 py-5 sm:px-6"
          >
            {SITE_CONFIG.navPrincipal.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`rounded-xl px-4 py-3 text-base font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-sage-100 text-brand-dark font-semibold'
                    : 'text-earth-body hover:bg-sand/60 hover:text-brand-dark'
                }`}
              >
                {item.label}
              </Link>
            ))}

            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMobileMenuOpen(false)}
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-terracotta px-6 py-3 text-base font-semibold text-white shadow-soft transition-colors hover:bg-terracotta-dark"
            >
              <CalendarCheck className="h-5 w-5" aria-hidden="true" />
              Agendar Consulta
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}