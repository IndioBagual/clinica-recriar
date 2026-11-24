import Link from 'next/link';
import { MapPin, Building2, ArrowRight, ExternalLink } from 'lucide-react';
import Layout from '../../components/Layout';
import SeoHead from '../../components/seo/SeoHead';
import SectionHeading from '../../components/ui/SectionHeading';
import { LISTA_UNIDADES } from '../../config/site';
import { profissionais } from '../../data/profissionais';

export default function UnidadesIndexPage() {
  return (
    <Layout>
      <SeoHead
        title="Nossas Unidades"
        description="Conheça as duas unidades da Clínica Recriar em Rio Grande - RS: Unidade Tiradentes e Unidade Abreu."
        path="/unidades"
      />

      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Onde Estamos"
            title="Nossas Unidades em Rio Grande"
            description="Selecione uma unidade para ver os profissionais, o mapa de localização e os canais de agendamento."
          />

          <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-8 md:grid-cols-2">
            {LISTA_UNIDADES.map((un, idx) => {
              const Icone = idx === 0 ? MapPin : Building2;
              const qtd = profissionais.filter((p) => p.unidades?.includes(un.id)).length;

              return (
                <article
                  key={un.slug}
                  className="flex flex-col justify-between rounded-organic border border-sand-dark/60 bg-white p-8 shadow-soft"
                >
                  <div>
                    <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-100 text-brand">
                      <Icone className="h-7 w-7" aria-hidden="true" />
                    </div>
                    <h2 className="font-serif text-3xl font-semibold text-brand-dark">
                      {un.nome}
                    </h2>
                    <p className="mt-3 text-base text-earth-body">{un.enderecoCompleto}</p>
                    <p className="mt-2 text-sm font-medium text-sage-700">
                      {qtd} profissionais com atendimento nesta unidade
                    </p>
                  </div>

                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link
                      href={un.rota}
                      className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
                    >
                      Acessar unidade
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <a
                      href={un.mapaLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-sand-dark px-5 py-3 text-sm font-semibold text-earth-body hover:border-brand hover:text-brand"
                    >
                      Google Maps
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </Layout>
  );
}