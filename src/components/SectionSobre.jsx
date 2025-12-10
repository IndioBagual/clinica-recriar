import Reveal from './Reveal'; // Importa o nosso componente
import { Users, ClipboardList, HeartPulse } from 'lucide-react';

export default function SectionSobre() {
  return (
    <section id="sobre" className="py-20 bg-white">
      <div className="container mx-auto px-6">
        
        <div className="text-center mb-16">
          {/* Animação no Título */}
          <Reveal>
            <h2 className="text-4xl font-extrabold text-brand-dark mb-4">Nossa Abordagem Multidisciplinar</h2>
          </Reveal>
          
          {/* Animação no Texto com um pequeno atraso (delay) */}
          <Reveal delay={0.2}>
            <p className="text-lg text-gray-500 max-w-3xl mx-auto">
              Acreditamos que o atendimento multidisciplinar auxilia em diversos contextos...
            </p>
          </Reveal>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Card 1 */}
           <Reveal delay={0.2}>
            <div className="bg-light p-8 rounded-2xl text-center shadow-sm hover:shadow-xl hover:scale-105 transition-all duration-300">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#E6F6F5] text-brand rounded-full mb-6">
                <Users className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-dark">Cuidado Integrado</h3>
              <p className="text-gray-600">Profissionais de diferentes áreas colaboram para garantir que todos os aspectos da sua saúde sejam atendidos.</p>
            </div>
          </Reveal>

          {/* Card 2 */}
          <Reveal delay={0.4}>
            <div className="bg-light p-8 rounded-2xl text-center shadow-sm hover:shadow-xl hover:scale-105 transition-all duration-300">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#E6F6F5] text-brand rounded-full mb-6">
                <ClipboardList className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-dark">Atendimento Focalizado</h3>
              <p className="text-gray-600">São realizados atendimentos focados no paciente, para auxiliar suas necessidades específicas.</p>
            </div>
          </Reveal>
          {/* Card 3 */}
          <Reveal delay={0.6}>
            <div className="bg-light p-8 rounded-2xl text-center shadow-sm hover:shadow-xl hover:scale-105 transition-all duration-300">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-[#E6F6F5] text-brand rounded-full mb-6">
                <HeartPulse className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-dark">Foco no Bem-Estar</h3>
              <p className="text-gray-600">Nosso objetivo, além de tratar a saúde, é trazer comodidade e bom atendimento.</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}