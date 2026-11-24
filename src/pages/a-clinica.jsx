import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionSobre from '../components/SectionSobre';
import SectionServicos from '../components/SectionServicos';
import { LISTA_UNIDADES } from '../config/site';
import { resolverImagem } from '../lib/midia';

export default function AClinicaPage() {
  return (
    <Layout>
      <SeoHead
        title="A Clínica"
        description="Conheça a Clínica Recriar, nossa abordagem multidisciplinar e nossas unidades em Rio Grande - RS."
        path="/a-clinica"
      />

      <section className="border-b border-sand-dark/60 bg-cream-soft py-16 md:py-20">
        <div className="container mx-auto grid grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-7">
            <span className="inline-flex rounded-full bg-sage-100 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
              Institucional
            </span>
            <h1 className="mt-4 font-serif text-4xl font-semibold text-brand-dark md:text-5xl">
              Clínica Recriar
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-earth-body">
              Na Clínica Recriar, reunimos profissionais de Psicologia, Psicopedagogia,
              Nutrição e Fonoaudiologia em duas unidades localizadas no bairro Cidade Nova,
              em Rio Grande - RS.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/equipe"
                className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Conhecer nossa equipe
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/unidades"
                className="inline-flex items-center gap-2 rounded-full border border-brand bg-white px-6 py-3 text-sm font-semibold text-brand-dark hover:bg-sage-50"
              >
                Ver unidades
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-organic border border-sand-dark/60 shadow-card">
              <Image
                src={resolverImagem(SITE_CONFIG.imagemFachadaPrincipal)}
                alt="Fachada da Clínica Recriar"
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

      <section className="bg-cream py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl rounded-organic border border-sand-dark/60 bg-white p-8 shadow-soft md:p-10">
            <h2 className="font-serif text-2xl font-semibold text-brand-dark">
              Nossas Unidades em Rio Grande
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
              {LISTA_UNIDADES.map((un) => (
                <div key={un.slug} className="rounded-2xl bg-cream-soft p-5">
                  <h3 className="font-serif text-xl font-semibold text-brand-dark">
                    {un.nome}
                  </h3>
                  <p className="mt-1 text-sm text-earth-body">{un.enderecoCompleto}</p>
                  <Link
                    href={un.rota}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
                  >
                    Ver detalhes da unidade
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}