import { Calendar } from 'lucide-react';
import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionHeading from '../components/ui/SectionHeading';
import { SITE_CONFIG } from '../config/site';

export default function EventosPage() {
  return (
    <Layout>
      <SeoHead
        title="Eventos e Comunicados"
        description="Acompanhe os eventos, ações e comunicados oficiais da Clínica Recriar."
        path="/eventos"
      />

      <section className="py-16 md:py-24">
        <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Comunicação"
            title="Eventos e Comunicados"
            description="Espaço dedicado à divulgação de ações institucionais, encontros, palestras e avisos importantes da Clínica Recriar."
          />

          <div className="mt-10 rounded-organic border border-sand-dark/60 bg-white p-10 text-center shadow-soft">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-100 text-brand">
              <Calendar className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="mt-5 font-serif text-2xl font-semibold text-brand-dark">
              Nenhum evento ou comunicado publicado no momento
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-earth-body">
              Novos comunicados serão publicados aqui assim que confirmados pela equipe. Você
              também pode acompanhar nossas atualizações no{' '}
              <a
                href={SITE_CONFIG.redesSociais.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand underline"
              >
                Instagram da Clínica Recriar
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}