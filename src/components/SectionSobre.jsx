import { Users, ClipboardList, HeartPulse } from 'lucide-react';
import Reveal from './Reveal';
import SectionHeading from './ui/SectionHeading';

const PILARES = [
  {
    titulo: 'Cuidado Integrado',
    descricao:
      'Profissionais de diferentes áreas colaboram para garantir que todos os aspectos da sua saúde sejam atendidos.',
    Icone: Users,
  },
  {
    titulo: 'Atendimento Focalizado',
    descricao:
      'São realizados atendimentos focados no paciente, para auxiliar suas necessidades específicas.',
    Icone: ClipboardList,
  },
  {
    titulo: 'Foco no Bem-Estar',
    descricao:
      'Nosso objetivo, além de tratar a saúde, é trazer comodidade e bom atendimento.',
    Icone: HeartPulse,
  },
];

export default function SectionSobre() {
  return (
    <section id="sobre" className="bg-cream py-20 md:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="A Clínica"
            title="Nossa Abordagem Multidisciplinar"
            description="Acreditamos que o atendimento multidisciplinar auxilia em diversos contextos..."
          />
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8">
          {PILARES.map(({ titulo, descricao, Icone }, index) => (
            <Reveal key={titulo} delay={index * 0.1}>
              <article className="flex h-full flex-col rounded-organic border border-sand-dark/60 bg-white/90 p-8 shadow-soft transition-transform duration-300 hover:-translate-y-1">
                <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-100 text-brand">
                  <Icone className="h-7 w-7" aria-hidden="true" />
                </div>
                <h3 className="font-serif text-2xl font-semibold text-brand-dark">
                  {titulo}
                </h3>
                <p className="mt-3 leading-relaxed text-earth-body">
                  {descricao}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}