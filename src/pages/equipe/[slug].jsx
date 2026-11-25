import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, MapPin, CheckCircle2 } from 'lucide-react';
import Layout from '../../components/Layout';
import SeoHead from '../../components/seo/SeoHead';
import { profissionais } from '../../data/profissionais';
import { SITE_CONFIG, UNIDADES, criarLinkWhatsapp } from '../../config/site';
import { resolverImagem } from '../../lib/midia';

export default function PerfilProfissional({ profissional }) {
  const router = useRouter();

  if (router.isFallback) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 text-center text-earth-muted">
          Carregando perfil...
        </div>
      </Layout>
    );
  }

  if (!profissional) {
    return (
      <Layout>
        <SeoHead title="Profissional não encontrado" path="/equipe" noIndex />
        <div className="container mx-auto px-4 py-24 text-center">
          <h1 className="font-serif text-3xl font-semibold text-brand-dark">
            Profissional não encontrado
          </h1>
          <Link
            href="/equipe"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar para a equipe
          </Link>
        </div>
      </Layout>
    );
  }

  const isEmBreve = profissional.status === 'Em breve';
  const unidadesProf =
    Array.isArray(profissional.unidades) && profissional.unidades.length > 0
      ? profissional.unidades
      : ['Tiradentes'];

  const mensagemWhatsapp = isEmBreve
    ? `Olá, gostaria de consultar a disponibilidade de atendimento com ${profissional.nome}.`
    : `Olá, gostaria de marcar atendimento com ${profissional.nome}.`;

  const whatsappUrl = criarLinkWhatsapp(mensagemWhatsapp, profissional.whatsapp);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profissional.nome,
    jobTitle: profissional.cargo,
    worksFor: {
      '@type': 'MedicalClinic',
      name: SITE_CONFIG.nome,
    },
  };

  return (
    <Layout>
      <SeoHead
        title={`${profissional.nome} - ${profissional.cargo}`}
        description={`Conheça ${profissional.nome}, ${profissional.cargo} (${profissional.registro}) na Clínica Recriar em Rio Grande - RS.`}
        path={`/equipe/${profissional.slug}`}
        jsonLd={jsonLd}
      />

      <section className="py-12 md:py-16">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <Link
            href="/equipe"
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar para toda a equipe
          </Link>

          <article className="overflow-hidden rounded-organic border border-sand-dark/60 bg-white p-6 shadow-card sm:p-10 md:p-12">
            <div className="flex flex-col items-start gap-10 md:flex-row">
              <div className="flex w-full shrink-0 flex-col items-center md:w-72">
                <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-sage-200 shadow-soft md:h-72 md:w-72">
                  <Image
                    src={resolverImagem(profissional.foto)}
                    alt={`Foto de ${profissional.nome}`}
                    fill
                    priority
                    sizes="(max-width: 768px) 256px, 288px"
                    className={`object-cover object-top ${
                      isEmBreve ? 'grayscale opacity-80' : ''
                    }`}
                  />
                  {isEmBreve && (
                    <div className="absolute inset-x-0 bottom-0 bg-brand-dark/85 py-2 text-center text-xs font-bold uppercase tracking-widest text-white">
                      Em breve
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {unidadesProf.map((un) => {
                    const rota =
                      un === 'Abreu' ? UNIDADES.abreu.rota : UNIDADES.tiradentes.rota;
                    return (
                      <Link
                        key={un}
                        href={rota}
                        className="inline-flex items-center gap-1.5 rounded-full bg-sage-100 px-3.5 py-1.5 text-xs font-semibold text-brand-dark hover:bg-sage-200"
                      >
                        <MapPin className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
                        Unidade {un}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 space-y-8">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-terracotta-dark">
                    {profissional.cargo} · {profissional.registro}
                  </p>
                  <h1 className="mt-2 font-serif text-3xl font-semibold text-brand-dark md:text-4xl">
                    {profissional.nome}
                  </h1>
                </div>

                <div>
                  <h2 className="border-b border-sand-dark/60 pb-2 font-serif text-2xl font-semibold text-brand-dark">
                    Sobre Mim
                  </h2>
                  <div className="mt-4 space-y-4 text-base leading-relaxed text-earth-body">
                    {profissional.bio.map((paragrafo, index) => (
                      <p key={index}>{paragrafo}</p>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="border-b border-sand-dark/60 pb-2 font-serif text-2xl font-semibold text-brand-dark">
                    Especialidades e Formação
                  </h2>
                  <ul className="mt-4 space-y-2.5 text-base text-earth-body">
                    {profissional.especialidades.map((item, index) => (
                      <li key={index} className="flex items-start gap-2.5">
                        <CheckCircle2
                          className="mt-1 h-4 w-4 shrink-0 text-brand"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-2">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-full bg-terracotta-dark px-8 py-3.5 text-base font-semibold text-white shadow-soft transition-colors hover:bg-[#8A412A] sm:w-auto"
                  >
                    {isEmBreve ? 'Avise-me / Consultar disponibilidade' : 'Agendar Consulta'}
                  </a>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>
    </Layout>
  );
}

export async function getStaticPaths() {
  const paths = profissionais.map((prof) => ({
    params: { slug: prof.slug },
  }));

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const profissional = profissionais.find((p) => p.slug === params.slug) || null;

  return {
    props: {
      profissional,
    },
  };
}