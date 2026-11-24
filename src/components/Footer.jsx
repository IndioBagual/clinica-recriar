import Link from 'next/link';
import Image from 'next/image';
import { Facebook, Instagram, Mail, MapPin, Phone } from 'lucide-react';
import { SITE_CONFIG, LISTA_UNIDADES, criarLinkWhatsapp } from '../config/site';
import { resolverImagem } from '../lib/midia';

export default function Footer() {
  return (
    <footer className="border-t border-sage-700/30 bg-brand-dark text-cream/90">
      <div className="container mx-auto px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-4">
            <Image
              src={resolverImagem('/img/Logo recriar.png')}
              alt="Clínica Recriar"
              width={148}
              height={44}
              className="h-10 w-auto brightness-0 invert opacity-90"
            />
            <p className="text-sm leading-relaxed text-sage-100/90">
              {SITE_CONFIG.slogan}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <a
                href={SITE_CONFIG.redesSociais.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook da Clínica Recriar"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-cream transition-colors hover:bg-terracotta"
              >
                <Facebook className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href={SITE_CONFIG.redesSociais.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram da Clínica Recriar"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-cream transition-colors hover:bg-terracotta"
              >
                <Instagram className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-serif text-lg font-semibold text-white">Navegação</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-sage-100/90">
              <li><Link href="/a-clinica" className="hover:text-white transition-colors">A Clínica</Link></li>
              <li><Link href="/equipe" className="hover:text-white transition-colors">Nossa Equipe</Link></li>
              <li><Link href="/servicos" className="hover:text-white transition-colors">Especialidades e Serviços</Link></li>
              <li><Link href="/convenios" className="hover:text-white transition-colors">Convênios e Agendamentos</Link></li>
              <li><Link href="/escuta" className="hover:text-white transition-colors">Espaço de Escuta</Link></li>
              <li><Link href="/eventos" className="hover:text-white transition-colors">Eventos e Comunicados</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-serif text-lg font-semibold text-white">Nossas Unidades</h3>
            <ul className="mt-4 space-y-4 text-sm text-sage-100/90">
              {LISTA_UNIDADES.map((un) => (
                <li key={un.slug} className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-terracotta-soft" aria-hidden="true" />
                  <div>
                    <Link href={un.rota} className="font-semibold text-white hover:underline">
                      {un.nome}
                    </Link>
                    <p className="text-sage-200/90">{un.enderecoCompleto}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-serif text-lg font-semibold text-white">Atendimento</h3>
            <ul className="mt-4 space-y-3 text-sm text-sage-100/90">
              <li>
                <a
                  href={criarLinkWhatsapp()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2.5 hover:text-white transition-colors"
                >
                  <Phone className="h-4 w-4 shrink-0 text-terracotta-soft" aria-hidden="true" />
                  <span>{SITE_CONFIG.telefoneExibicao}</span>
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${SITE_CONFIG.email}`}
                  className="inline-flex items-center gap-2.5 hover:text-white transition-colors"
                >
                  <Mail className="h-4 w-4 shrink-0 text-terracotta-soft" aria-hidden="true" />
                  <span>{SITE_CONFIG.email}</span>
                </a>
              </li>
              <li className="pt-2">
                <Link href="/contato" className="hover:text-white underline underline-offset-4">
                  Ver mapas e contatos
                </Link>
              </li>
              <li>
                <Link href="/privacidade" className="hover:text-white underline underline-offset-4">
                  Aviso de Privacidade
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/15 pt-6 text-xs text-sage-200/80 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} {SITE_CONFIG.nome}. Todos os direitos reservados.</p>
          <p>Rio Grande — Rio Grande do Sul</p>
        </div>
      </div>
    </footer>
  );
}