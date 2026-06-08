import Head from 'next/head';
import Layout from '../components/Layout';
import TeamSection from '../components/TeamSection';
import SectionSobre from '../components/SectionSobre';
import SectionServicos from '../components/SectionServicos';
import SectionConvenios from '../components/SectionConvenios';
import SectionContato from '../components/SectionContato';

export default function Home() {
  return (
    <Layout unidade="Tiradentes">
      <Head>
        <title>Unidade Tiradentes | Clínica Recriar</title>
      </Head>

      {/* Hero Section (Banner Principal) */}
      <section id="home" className="relative min-h-screen flex items-center pt-24 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url(/img/frente.jpg)' }}>
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/90 to-transparent"></div>
        <div className="container mx-auto px-6 relative z-10">
            <div className="w-full lg:w-1/2 py-12">
                <span className="block text-brand font-semibold uppercase tracking-wider mb-2">Clínica Recriar</span>
                <h1 className="text-4xl md:text-6xl font-extrabold text-dark leading-tight mb-6">
                    Atendimento prestado de forma Multidisciplinar
                </h1>
                <p className="text-lg md:text-xl text-gray-500 mb-8 leading-relaxed">
                    Na Clínica Recriar, temos profissionais capacitados em diversas áreas, como Psicologia, Nutrição, Psicopedagogia e Fonoaudiologia.
                </p>
                <a href="#contato" className="inline-block bg-brand hover:bg-brand-dark text-white font-bold py-4 px-8 rounded-lg shadow-xl hover:scale-105 transition-all duration-300">
                    Fale Conosco
                </a>
            </div>
        </div>
      </section>

      {/* Componentes Modulares */}
      <SectionSobre />
      <SectionServicos />
      <TeamSection unidadeAtual="Tiradentes" />
      <SectionConvenios />
      <SectionContato unidade="Tiradentes" />

    </Layout>
  );
}