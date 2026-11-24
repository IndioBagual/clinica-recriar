import Link from 'next/link';
import Image from 'next/image';
import { MapPin, ArrowRight, ExternalLink } from 'lucide-react';
import Layout from './Layout';
import SeoHead from './seo/SeoHead';
import SectionSobre from './SectionSobre';
import SectionServicos from './SectionServicos';
import TeamSection from './TeamSection';
import SectionConvenios from './SectionConvenios';
import SectionContato from './SectionContato';
import { criarLinkWhatsapp, UNIDADES } from '../config/site';
import { resolverImagem } from '../lib/midia';

export default function UnidadePageContent({ unidade }) {
  const outraUnidade =
    unidade.slug === 'tiradentes' ? UNIDADES.abreu : UNIDADES.tiradentes;

  return (
    <Layout>
      <SeoHead
        title={unidade.nome}
        description={`${unidade.nome} da Clínica Recriar em ${unidade.enderecoCompleto}. Atendimento multidisciplinar em Psicologia, Nutrição, Psicopedagogia e Fonoaudiologia.`}
        path={unidade.rota}
      />

      <section className="relative overflow-hidden border-b border-sand-dark/60 bg-cream-soft">
        <div className="container mx-auto grid grid-cols-1 items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-20">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-2 rounded-full bg-sage-100 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {unidade.nome} · Rio Grande - RS
            </span>

            <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight text-brand-dark md:text-5xl">
              {unidade.nome}: Atendimento Multidisciplinar
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-earth-body">
              Na Clínica Recriar, temos profissionais capacitados em diversas áreas, como
              Psicologia, Nutrição, Psicopedagogia e Fonoaudiologia.
            </p>

            <p className="mt-4 text-sm font-medium text-earth-muted">
              {unidade.enderecoCompleto}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href={criarLinkWhatsapp(
                  `Olá, gostaria de agendar uma consulta na ${unidade.nome} da Clínica Recriar.`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full bg-terracotta-dark px-7 py-3.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-[#8A412A]"
              >
                Agendar nesta unidade
              </a>

              <a
                href={unidade.mapaLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-brand bg-white px-6 py-3.5 text-sm font-semibold text-brand-dark transition-colors hover:bg-sage-50"
              >
                Como chegar
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>

              <Link
                href={outraUnidade.rota}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
              >
                Conhecer {outraUnidade.nome}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-organic border border-sand-dark/60 shadow-card">
              <Image
                src={resolverImagem(unidade.fotoFachada)}
                alt={`Fachada da Clínica Recriar - ${unidade.nome}`}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 42vw"
                className="object-cover object-[center_40%]"
              />
            </div>
          </div>
        </div>
      </section>

      <SectionSobre />
      <SectionServicos />
      <TeamSection
        unidadeAtual={unidade.id}
        titulo={`Equipe da ${unidade.nome}`}
        descricao="Conheça os profissionais que atendem nesta unidade e acesse o perfil individual de cada especialista."
      />
      <SectionConvenios />
      <SectionContato unidade={unidade.id} />
    </Layout>
  );
}