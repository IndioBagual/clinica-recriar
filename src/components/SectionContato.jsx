import Image from 'next/image';
import { MapPin, Mail, ExternalLink } from 'lucide-react';
import { SITE_CONFIG, UNIDADES, LISTA_UNIDADES, criarLinkWhatsapp } from '../config/site';
import { resolverImagem } from '../lib/midia';
import SectionHeading from './ui/SectionHeading';

export default function SectionContato({ unidade = null }) {
  const unidadeObj =
    unidade === 'Abreu'
      ? UNIDADES.abreu
      : unidade === 'Tiradentes'
      ? UNIDADES.tiradentes
      : null;

  const unidadesExibidas = unidadeObj ? [unidadeObj] : LISTA_UNIDADES;
  const whatsappUrl = criarLinkWhatsapp();

  return (
    <section id="contato" className="bg-cream py-20 md:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Atendimento"
          title="Pronto para Recomeçar?"
          description="Entre em contato conosco para agendar sua primeira consulta. Estamos aqui para ouvir você."
        />

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-organic border border-sand-dark/60 bg-white p-8 shadow-soft">
            <h3 className="font-serif text-2xl font-semibold text-brand-dark">
              Canais de Agendamento
            </h3>
            <div className="mt-6 space-y-5 text-earth-body">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 rounded-2xl border border-sage-200 bg-sage-50/70 p-4 transition-colors hover:border-brand"
              >
                <Image
                  src={resolverImagem('/img/Whatsapp.png')}
                  alt="Ícone WhatsApp"
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0"
                />
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-sage-700">
                    WhatsApp Central
                  </span>
                  <span className="text-base font-bold text-brand-dark">
                    {SITE_CONFIG.telefoneExibicao}
                  </span>
                </div>
              </a>

              <a
                href={`mailto:${SITE_CONFIG.email}`}
                className="flex items-center gap-4 rounded-2xl border border-sand-dark/60 bg-cream/70 p-4 transition-colors hover:border-brand"
              >
                <Mail className="h-6 w-6 shrink-0 text-brand" aria-hidden="true" />
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-earth-muted">
                    E-mail Institucional
                  </span>
                  <span className="break-all text-base font-semibold text-brand-dark">
                    {SITE_CONFIG.email}
                  </span>
                </div>
              </a>
            </div>

            <div className="mt-7">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center rounded-full bg-terracotta-dark px-7 py-3.5 text-base font-semibold text-white shadow-soft transition-colors hover:bg-[#8A412A]"
              >
                Agendar Consulta pelo WhatsApp
              </a>
            </div>
          </div>

          <div className="space-y-6">
            {unidadesExibidas.map((un) => (
              <div
                key={un.slug}
                className="overflow-hidden rounded-organic border border-sand-dark/60 bg-white shadow-soft"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                      <div>
                        <h3 className="font-serif text-xl font-semibold text-brand-dark">
                          {un.nome}
                        </h3>
                        <p className="mt-1 text-sm text-earth-body">{un.enderecoCompleto}</p>
                      </div>
                    </div>
                    <a
                      href={un.mapaLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sage-50 px-3 py-1.5 text-xs font-semibold text-brand-dark hover:bg-sage-100"
                    >
                      Abrir mapa
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>
                <div className="h-56 w-full border-t border-sand-dark/50 bg-sand/30">
                  <iframe
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={un.mapaSrc}
                    title={`Mapa da ${un.nome}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}