import Link from 'next/link';
import { BrainCircuit, Puzzle, Leaf, MessageCircle, ArrowRight } from 'lucide-react';
import Reveal from './Reveal';
import SectionHeading from './ui/SectionHeading';
import { SERVICOS } from '../data/servicos';

const ICONES = {
  brain: BrainCircuit,
  puzzle: Puzzle,
  leaf: Leaf,
  speech: MessageCircle,
};

export default function SectionServicos({ mostrarLinkEquipe = true }) {
  return (
    <section id="servicos" className="border-y border-sand-dark/50 bg-cream-soft py-20 md:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Especialidades"
            title="Nossos Serviços"
            description="Oferecemos diversos serviços para todas as faixas etárias."
          />
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {SERVICOS.map((servico, index) => {
            const Icone = ICONES[servico.icone] || Leaf;
            return (
              <Reveal key={servico.slug} delay={index * 0.08}>
                <article className="flex h-full flex-col rounded-organic border border-sand-dark/60 bg-cream p-7 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-sage-300">
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sage-100 text-brand">
                    <Icone className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <h3 className="font-serif text-2xl font-semibold text-brand-dark">
                    {servico.nome}
                  </h3>
                  <p className="mt-3 flex-grow leading-relaxed text-earth-body">
                    {servico.descricao}
                  </p>
                  {mostrarLinkEquipe && (
                    <Link
                      href={`/equipe?area=${encodeURIComponent(servico.nome)}`}
                      className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark"
                    >
                      Ver profissionais
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}