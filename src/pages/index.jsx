import Link from 'next/link';
import Image from 'next/image';
import { MapPin, Building2, ArrowRight, Users } from 'lucide-react';
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

      {/* Hero + Seleção imediata das unidades */}
      <section className="relative overflow-hidden border-b border-sand-dark/60 bg-paper-subtle">
        <div className="container mx-auto px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-2 rounded-full bg-sage-100 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
                Clínica Multidisciplinar · Rio Grande - RS
              </span>

              <h1 className="mt-4 font-serif text-4xl font-semibold leading-[1.15] text-brand-dark sm:text-5xl">
                Acolhimento humano e cuidado integrado em cada etapa da vida
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-earth-body">
                Na Clínica Recriar, temos profissionais capacitados em diversas áreas, como
                Psicologia, Nutrição, Psicopedagogia e Fonoaudiologia. Selecione uma de nossas
                unidades ou conheça toda a equipe.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={criarLinkWhatsapp()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full bg-terracotta-dark px-7 py-3.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-[#8A412A]"
                >
                  Agendar Consulta
                </a>
                <Link
                  href="/equipe"
                  className="inline-flex items-center gap-2 rounded-full border border-brand bg-white px-6 py-3.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-sage-50"
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Conhecer os {profissionais.length} profissionais
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-organic border border-sand-dark/60 shadow-card">
                <Image
                  src={resolverImagem('/img/frente.jpg')}
                  alt="Fachada da Clínica Recriar em Rio Grande"
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 42vw"
                  className="object-cover"
                />
              </div>
            </div>
          </div>

          {/* Seleção de Unidades preservada logo na entrada */}
          <div className="mt-14">
            <h2 className="font-serif text-2xl font-semibold text-brand-dark">
              Selecione a unidade desejada para atendimento
            </h2>
            <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
              {LISTA_UNIDADES.map((un, idx) => {
                const Icone = idx === 0 ? MapPin : Building2;
                const qtdUnidade = profissionais.filter((p) =>
                  p.unidades?.includes(un.id)
                ).length;

                return (
                  <Reveal key={un.slug} delay={idx * 0.1}>
                    <Link
                      href={un.rota}
                      className="group flex h-full items-start justify-between gap-6 rounded-organic border border-sand-dark/70 bg-white p-7 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-brand hover:shadow-card"
                    >
                      <div className="flex items-start gap-4">
                        <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sage-100 text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                          <Icone className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div>
                          <h3 className="font-serif text-2xl font-semibold text-brand-dark group-hover:text-brand">
                            {un.nome}
                          </h3>
                          <p className="mt-1 text-sm text-earth-body">
                            {un.enderecoCurto} · {un.bairroCidade}
                          </p>
                          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-sage-700">
                            {qtdUnidade} profissionais vinculados
                          </p>
                        </div>
                      </div>
                      <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-soft text-brand transition-transform group-hover:translate-x-1">
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </Link>
                  </Reveal>
                );
              })}
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