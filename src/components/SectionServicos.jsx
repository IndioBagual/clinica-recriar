import { BrainCircuit, Puzzle, Leaf, MessageCircle } from 'lucide-react';
import Reveal from './Reveal';

export default function SectionServicos() {
  return (
    <section id="servicos" className="py-20 bg-light">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold text-brand-dark mb-4">Nossos Serviços</h2>
          <p className="text-lg text-gray-500 max-w-3xl mx-auto">Oferecemos diversos serviços para todas as faixas etárias.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {/* Psicologia */}
          <Reveal delay={0.1}>
            <div className="bg-white rounded-2xl shadow-lg hover:-translate-y-2 hover:shadow-xl transition-all duration-300 overflow-hidden h-full flex flex-col p-8 text-center items-center">
              <div className="text-brand mb-6">
                <BrainCircuit className="w-12 h-12" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-dark">Psicologia</h3>
              <p className="text-gray-500 leading-relaxed">Cuidamos da sua saúde mental e emocional, oferecendo um caminho para o autoconhecimento.</p>
            </div>
          </Reveal>

          {/* Psicopedagogia */}
          <Reveal delay={0.2}>
            <div className="bg-white rounded-2xl shadow-lg hover:-translate-y-2 hover:shadow-xl transition-all duration-300 overflow-hidden h-full flex flex-col p-8 text-center items-center">
              <div className="text-brand mb-6">
              <Puzzle className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-bold mb-4 text-dark">Psicopedagogia</h3>
            <p className="text-gray-500 leading-relaxed">Transformamos dificuldades em conquistas, potencializando o processo de aprendizagem.</p>
          </div>
          </Reveal>

          {/* Nutrição */}
          <Reveal delay={0.3}>
            <div className="bg-white rounded-2xl shadow-lg hover:-translate-y-2 hover:shadow-xl transition-all duration-300 overflow-hidden h-full flex flex-col p-8 text-center items-center">
              <div className="text-brand mb-6">
                <Leaf className="w-12 h-12" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-dark">Nutrição</h3>
              <p className="text-gray-500 leading-relaxed">Guiamos você a uma relação saudável com a comida através de planos personalizados.</p>
            </div>
          </Reveal>

          {/* Fonoaudiologia */}
          <Reveal delay={0.4}>
            <div className="bg-white rounded-2xl shadow-lg hover:-translate-y-2 hover:shadow-xl transition-all duration-300 overflow-hidden h-full flex flex-col p-8 text-center items-center">
              <div className="text-brand mb-6">
                <MessageCircle className="w-12 h-12" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-dark">Fonoaudiologia</h3>
              <p className="text-gray-500 leading-relaxed">Aprimoramos a comunicação humana, atuando na reabilitação da fala e audição.</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}