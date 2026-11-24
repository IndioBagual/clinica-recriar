import Link from 'next/link';
import Image from 'next/image';
import { MapPin, Building2, ArrowRight, Users, CalendarCheck } from 'lucide-react';
import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionSobre from '../components/SectionSobre';
import SectionServicos from '../components/SectionServicos';
import SectionConvenios from '../components/SectionConvenios';
import SectionContato from '../components/SectionContato';
import Reveal from '../components/Reveal';
import { LISTA_UNIDADES, SITE_CONFIG, criarLinkWhatsapp } from '../config/site';
import { profissionais } from '../data/profissionais';
import { resolverImagem } from '../lib/midia';

export default function HomePage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: SITE_CONFIG.nome,
    url: SITE_CONFIG.urlBase,
    telephone: '+55-53-99128-1500',
    email: SITE_CONFIG.email,
    sameAs: [SITE_CONFIG.redesSociais.facebook, SITE_CONFIG.redesSociais.instagram],
    medicalSpecialty: ['Psychiatric', 'DietNutrition', 'SpeechPathology'],
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Rua Tiradentes, 20',
      addressLocality: 'Rio Grande',
      addressRegion: 'RS',
      postalCode: '96211-080',
      addressCountry: 'BR',
    },
  };

  return (
    <Layout>
      <SeoHead
        title="Atendimento Multidisciplinar em Rio Grande - RS"
        description="Clínica Recriar em Rio Grande - RS. Psicologia, Psicopedagogia, Nutrição e Fonoaudiologia nas unidades Tiradentes e Abreu."
        path="/"
        jsonLd={jsonLd}
      />

      {/* Hero panorâmico com a nova fachada + Seleção destacada de unidades */}
      <section className="relative overflow-hidden border-b border-sand-dark/60 bg-paper-subtle">
        <div className="container mx-auto px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:pb-20 lg:pt-10">
          {/* Nova Fachada em formato editorial amplo */}
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-organic border border-sand-dark/70 shadow-card sm:aspect-[21/9]">
            <Image
              src={resolverImagem(SITE_CONFIG.imagemFachadaPrincipal)}
              alt="Fachada atual da Clínica Recriar em Rio Grande - RS"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 1280px"
              className="object-cover object-[center_40%]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/80 via-brand-dark/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 lg:p-10">
              <span className="inline-flex items-center rounded-full bg-cream/95 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-dark shadow-sm">
                Clínica Multidisciplinar · Rio Grande - RS
              </span>
              <h1 className="mt-3 max-w-3xl font-serif text-2xl font-semibold leading-tight text-white drop-shadow-sm sm:text-4xl lg:text-5xl">
                Acolhimento humano e cuidado integrado em cada etapa da vida
              </h1>
            </div>
          </div>

          {/* Bloco de Seleção de Unidades — maior, expressivo e imediato */}
          <div className="relative z-10 mx-auto -mt-4 max-w-5xl rounded-organic border-2 border-sage-200 bg-cream/95 p-6 shadow-card backdrop-blur-sm sm:-mt-8 sm:p-8 lg:p-10">
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-terracotta-dark">
                Escolha por onde começar
              </p>
              <h2 className="mt-2 font-serif text-2xl font-semibold text-brand-dark sm:text-3xl">
                Selecione a unidade desejada para atendimento
              </h2>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-earth-body sm:text-base">
                Na Clínica Recriar, contamos com profissionais de Psicologia, Nutrição,
                Psicopedagogia e Fonoaudiologia em duas unidades no bairro Cidade Nova.
              </p>
            </div>

            <div className="mt-7 grid grid-cols-1 gap-6 md:grid-cols-2">
              {LISTA_UNIDADES.map((un, idx) => {
                const Icone = idx === 0 ? MapPin : Building2;
                const qtdUnidade = profissionais.filter((p) =>
                  p.unidades?.includes(un.id)
                ).length;

                return (
                  <Reveal key={un.slug} delay={idx * 0.08}>
                    <Link
                      href={un.rota}
                      className="group flex h-full flex-col justify-between rounded-organic border-2 border-sage-200 bg-white p-7 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:border-brand hover:shadow-card sm:p-8"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-4">
                          <div className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-sage-100 text-brand transition-colors duration-300 group-hover:bg-brand group-hover:text-white">
                            <Icone className="h-8 w-8" aria-hidden="true" />
                          </div>
                          <span className="rounded-full bg-sage-50 px-3.5 py-1.5 text-xs font-semibold text-sage-700 border border-sage-200">
                            {qtdUnidade} profissionais
                          </span>
                        </div>

                        <h3 className="mt-5 font-serif text-2xl font-semibold text-brand-dark transition-colors group-hover:text-brand sm:text-3xl">
                          {un.nome}
                        </h3>

                        <p className="mt-2 text-base font-medium text-earth-body">
                          {un.enderecoCurto}
                        </p>
                        <p className="text-sm text-earth-muted">{un.bairroCidade}</p>
                      </div>

                      <div className="mt-7">
                        <span className="flex w-full items-center justify-center gap-2.5 rounded-full bg-brand px-6 py-4 text-base font-semibold text-white shadow-soft transition-all duration-300 group-hover:bg-brand-dark">
                          Acessar {un.nome}
                          <ArrowRight
                            className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1"
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                    </Link>
                  </Reveal>
                );
              })}
            </div>

            {/* Ações secundárias centralizadas abaixo das unidades */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-4 border-t border-sand-dark/60 pt-6">
              <a
                href={criarLinkWhatsapp()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-terracotta-dark px-7 py-3.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-[#8A412A]"
              >
                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                Agendar Consulta pelo WhatsApp
              </a>
              <Link
                href="/equipe"
                className="inline-flex items-center gap-2 rounded-full border border-brand bg-white px-6 py-3.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-sage-50"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Ver todos os {profissionais.length} profissionais
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SectionSobre />
      <SectionServicos />
      <SectionConvenios />
      <SectionContato />
    </Layout>
  );
}