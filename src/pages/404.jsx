import Link from 'next/link';
import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';

export default function NotFoundPage() {
  return (
    <Layout>
      <SeoHead title="Página não encontrada" path="/404" noIndex />
      <section className="py-24">
        <div className="container mx-auto max-w-xl px-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-terracotta-dark">
            Erro 404
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold text-brand-dark">
            Página não encontrada
          </h1>
          <p className="mt-4 text-base text-earth-body">
            O endereço acessado não existe ou foi reorganizado. Você pode voltar para a página
            inicial ou escolher uma de nossas unidades.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/"
              className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Ir para o Início
            </Link>
            <Link
              href="/equipe"
              className="rounded-full border border-brand bg-white px-6 py-3 text-sm font-semibold text-brand-dark hover:bg-sage-50"
            >
              Ver Nossa Equipe
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}