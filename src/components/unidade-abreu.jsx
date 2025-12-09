import Head from 'next/head';
import Layout from './components/Layout';
import TeamSection from '../components/TeamSection';
import { MapPin, Phone, Mail } from 'lucide-react';

export default function UnidadeAbreu() {
  return (
    <Layout>
      <Head>
        <title>Unidade Abreu | Clínica Recriar</title>
        <meta name="description" content="Clínica Recriar - Unidade Abreu em Rio Grande, RS." />
      </Head>

      {/* --- Secção Hero (Topo) --- */}
      <section id="home" className="relative min-h-screen flex items-center pt-24 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: 'url(/img/frente.jpg)' }}>
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/90 to-transparent"></div>
        
        <div className="container mx-auto px-6 relative z-10">
            <div className="w-full lg:w-1/2 py-12">
                <span className="block text-brand font-semibold uppercase tracking-wider mb-2">Clínica Recriar</span>
                <h1 className="text-4xl md:text-6xl font-extrabold text-dark leading-tight mb-6">
                    Unidade Abreu: Atendimento Multidisciplinar
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

      {/* --- Secção Sobre (Reaproveitada) --- */}
      {/* Podes transformar isto num componente <Sobre /> se quiseres limpar este arquivo */}
      <section id="sobre" className="py-20 bg-white">
          <div className="container mx-auto px-6">
              <div className="text-center mb-16">
                  <h2 className="text-4xl font-extrabold text-brand-dark mb-4">Nossa Abordagem</h2>
                  <p className="text-lg text-gray-500 max-w-3xl mx-auto">
                      Acreditamos que o atendimento Multidisciplinar auxilia em diversos contextos de nossas vidas.
                  </p>
              </div>
              {/* ... (Conteúdo dos cards igual à Home principal) ... */}
          </div>
      </section>

      {/* --- Secção Equipe (A Mágica do Filtro) --- */}
      {/* Aqui dizemos ao componente para mostrar apenas quem trabalha no Abreu */}
      <TeamSection unidadeAtual="Abreu" />

      {/* --- Secção Contato (Específica do Abreu) --- */}
      <section id="contato" className="py-20 bg-light">
          <div className="container mx-auto px-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
                  <div className="text-left">
                      <h2 className="text-4xl font-extrabold text-brand-dark mb-6">Onde nos encontrar</h2>
                      <p className="text-xl text-gray-500 mb-8">
                          Estamos localizados no Bairro Cidade Nova.
                      </p>
                      
                      <div className="flex flex-col gap-6">
                          {/* Endereço Específico do Abreu */}
                          <a href="https://www.google.com/maps/place/R.+Gen.+Abreu,+52+-+Cidade+Nova,+Rio+Grande+-+RS,+96211-102/@-32.039868,-52.1079142,17z/data=!3m1!4b1!4m6!3m5!1s0x95119c09f5e2f361:0x2d213fae99d2e8e9!8m2!3d-32.0398726!4d-52.1053339!16s%2Fg%2F11crvzkhz2?entry=ttu&g_ep=EgoyMDI1MTEyMy4xIKXMDSoASAFQAw%3D%3D" target="_blank" rel="noreferrer" className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group">
                              <MapPin className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" />
                              <span>Rua General Abreu, 52 - Bairro Cidade Nova, Rio Grande, RS</span>
                          </a>
                          
                          <a href="https://api.whatsapp.com/send/?phone=5553991281500" target="_blank" rel="noreferrer" className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group">
                              {/* Podes usar o ícone do Lucide ou a imagem do Whatsapp */}
                              <Phone className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" />
                              <span>(53) 99128-1500</span>
                          </a>

                          <a href="mailto:clinicarecriar.rg@gmail.com" className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group">
                              <Mail className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" />
                              <span>clinicarecriar.rg@gmail.com</span>
                          </a>
                      </div>
                  </div>
                  {/* Podes adicionar o mapa aqui se quiseres */}
              </div>
          </div>
      </section>
    </Layout>
  );
}