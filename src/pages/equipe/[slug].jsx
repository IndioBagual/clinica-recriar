import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import Layout from '../../components/Layout';
import { profissionais } from '../../data/profissionais';
import { useRouter } from 'next/router';

export default function PerfilProfissional({ profissional }) {
  const router = useRouter();

  // Se a página ainda estiver a ser gerada (fallback), mostra algo simples
  if (router.isFallback) {
    return <div>Carregando...</div>;
  }

  // Se por algum motivo o profissional não for encontrado
  if (!profissional) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold text-gray-700">Profissional não encontrado</h1>
          <Link href="/#equipe" className="text-brand hover:underline mt-4 block">
            Voltar para a equipa
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Head>
        <title>{`${profissional.nome} - ${profissional.cargo} | Clínica Recriar`}</title>
        <meta name="description" content={`Saiba mais sobre ${profissional.nome}, ${profissional.cargo} na Clínica Recriar.`} />
      </Head>

      <section className="container mx-auto max-w-5xl">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden p-8 md:p-12 flex flex-col md:flex-row gap-10 items-start">
          
          {/* Foto do Profissional */}
          <div className="w-full md:w-1/3 flex justify-center md:justify-start">
            {/* O componente Image do Next.js otimiza automaticamente as imagens */}
            <div className="relative w-64 h-64 md:w-80 md:h-80">
              <Image 
                src={profissional.foto} 
                alt={`Foto de ${profissional.nome}`} 
                fill
                className="rounded-full object-cover border-[5px] border-brand shadow-xl"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />
            </div>
          </div>
          
          {/* Informações e Texto */}
          <div className="w-full md:w-2/3 space-y-8">
            <div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-dark mb-2">
                {profissional.nome}
              </h1>
              <p className="text-xl font-bold text-brand uppercase tracking-wide">
                {profissional.cargo} | {profissional.registro}
              </p>
            </div>

            {/* Bio (Renderiza cada parágrafo do array) */}
            <div>
              <h2 className="text-2xl font-bold text-brand-dark border-b-2 border-brand/30 pb-2 mb-4">Sobre Mim</h2>
              <div className="text-gray-600 leading-relaxed text-lg space-y-4">
                {profissional.bio.map((paragrafo, index) => (
                  <p key={index}>{paragrafo}</p>
                ))}
              </div>
            </div>

            {/* Especialidades */}
            <div>
              <h2 className="text-2xl font-bold text-brand-dark border-b-2 border-brand/30 pb-2 mb-4">Especialidades</h2>
              <ul className="list-disc pl-5 space-y-2 text-gray-600 text-lg marker:text-brand">
                {profissional.especialidades.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>

            {/* Botão de Agendamento */}
            <div className="pt-4">
              <a 
                href={`https://api.whatsapp.com/send/?phone=${profissional.whatsapp}&text=Olá+gostaria+de+marcar+atendimento+com+${encodeURIComponent(profissional.nome)}.`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-block bg-brand hover:bg-brand-dark text-white font-bold py-4 px-8 rounded-lg shadow-lg hover:scale-105 transition-transform text-center w-full md:w-auto"
              >
                Agendar Consulta
              </a>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

// ESTA PARTE É FUNDAMENTAL: Diz ao Next.js quais páginas criar
export async function getStaticPaths() {
  // Cria uma lista de caminhos baseada nos slugs do nosso arquivo de dados
  const paths = profissionais.map((prof) => ({
    params: { slug: prof.slug },
  }));

  return { paths, fallback: false }; // fallback: false significa que qualquer slug não listado dará erro 404
}

// ESTA PARTE BUSCA OS DADOS: Pega as informações do profissional específico para montar a página
export async function getStaticProps({ params }) {
  const profissional = profissionais.find((p) => p.slug === params.slug);

  return {
    props: {
      profissional,
    },
  };
}