import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Search, Info } from 'lucide-react';
import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionHeading from '../components/ui/SectionHeading';
import { CONVENIOS_ATIVOS } from '../data/convenios';
import { criarLinkWhatsapp, SITE_CONFIG } from '../config/site';
import { resolverImagem } from '../lib/midia';

export default function ConveniosPage() {
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return CONVENIOS_ATIVOS;
    return CONVENIOS_ATIVOS.filter((c) => c.nome.toLowerCase().includes(q));
  }, [busca]);

  return (
    <Layout>
      <SeoHead
        title="Convênios e Agendamentos"
        description="Consulte os convênios listados na Clínica Recriar e oriente-se para o agendamento nas unidades Tiradentes e Abreu."
        path="/convenios"
      />

      <section className="py-16 md:py-24">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Convênios e Agendamentos"
            title="Convênios Atendidos"
            description="Pesquise pelo nome do convênio abaixo e fale com nossa recepção para confirmar a cobertura na unidade e especialidade desejadas."
          />

          <div className="mx-auto mt-10 max-w-md">
            <label htmlFor="busca-convenio" className="sr-only">
              Pesquisar convênio por nome
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-earth-muted"
                aria-hidden="true"
              />
              <input
                id="busca-convenio"
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar convênio pelo nome..."
                className="w-full rounded-full border border-sand-dark bg-white py-3 pl-11 pr-4 text-sm text-earth placeholder:text-earth-muted shadow-soft"
              />
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-sage-200 bg-sage-50 p-5 text-sm text-earth-body">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <p className="leading-relaxed">
                <strong>Importante:</strong> a disponibilidade de atendimento, a necessidade de
                encaminhamento médico ou autorização prévia e os documentos exigidos variam
                conforme o plano, a unidade (Tiradentes ou Abreu), a especialidade e o
                profissional. Confirme sempre as condições vigentes no momento do agendamento.
              </p>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((convenio) => (
              <article
                key={convenio.slug}
                className="flex flex-col justify-between rounded-organic border border-sand-dark/60 bg-white p-6 shadow-soft"
              >
                <div>
                  <div className="relative mx-auto h-16 w-36">
                    <Image
                      src={resolverImagem(convenio.logo)}
                      alt={`Logotipo ${convenio.nome}`}
                      fill
                      sizes="144px"
                      className="object-contain"
                    />
                  </div>
                  <h2 className="mt-4 text-center font-serif text-xl font-semibold text-brand-dark">
                    {convenio.nome}
                  </h2>
                  <p className="mt-2 text-center text-xs text-earth-muted">
                    Regras detalhadas por unidade e especialidade em confirmação com a recepção.
                  </p>
                </div>

                <a
                  href={criarLinkWhatsapp(
                    `Olá, gostaria de verificar a cobertura e orientações de agendamento para o convênio ${convenio.nome}.`
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex w-full items-center justify-center rounded-full border border-brand bg-cream-soft px-4 py-2.5 text-xs font-semibold text-brand-dark transition-colors hover:bg-brand hover:text-white"
                >
                  Consultar cobertura no WhatsApp
                </a>
              </article>
            ))}
          </div>

          {filtrados.length === 0 && (
            <p className="mt-10 text-center text-sm text-earth-muted">
              Nenhum convênio encontrado para &ldquo;{busca}&rdquo;. Caso seu plano não esteja
              listado, consulte nossa recepção pelo WhatsApp {SITE_CONFIG.telefoneExibicao}.
            </p>
          )}
        </div>
      </section>
    </Layout>
  );
}