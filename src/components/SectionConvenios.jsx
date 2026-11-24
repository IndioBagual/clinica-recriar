import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import Reveal from './Reveal';
import SectionHeading from './ui/SectionHeading';
import { CONVENIOS_ATIVOS } from '../data/convenios';
import { resolverImagem } from '../lib/midia';

export default function SectionConvenios({ mostrarCta = true }) {
  return (
    <section id="convenios" className="border-y border-sand-dark/50 bg-sand/45 py-20 md:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Convênios"
            title="Convênios Atendidos"
            description="Confira os convênios listados na clínica. A cobertura e as orientações de agendamento podem variar conforme unidade, especialidade e plano."
          />
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mx-auto mt-12 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:gap-6">
            {CONVENIOS_ATIVOS.map((convenio) => (
              <div
                key={convenio.slug}
                className="flex h-28 items-center justify-center rounded-2xl border border-sand-dark/60 bg-white p-5 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-sage-300"
              >
                <div className="relative h-14 w-32">
                  <Image
                    src={resolverImagem(convenio.logo)}
                    alt={`Logotipo ${convenio.nome}`}
                    fill
                    sizes="128px"
                    className="object-contain opacity-90 transition-opacity hover:opacity-100"
                  />
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        {mostrarCta && (
          <div className="mt-10 text-center">
            <Link
              href="/convenios"
              className="inline-flex items-center gap-2 rounded-full border border-brand bg-white px-6 py-3 text-sm font-semibold text-brand-dark shadow-soft transition-colors hover:bg-brand hover:text-white"
            >
              Ver orientações sobre convênios e agendamento
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}