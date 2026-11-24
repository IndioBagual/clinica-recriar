import Link from 'next/link';
import { MessageSquare, ShieldCheck, Info } from 'lucide-react';
import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionHeading from '../components/ui/SectionHeading';
import { SITE_CONFIG, criarLinkWhatsapp } from '../config/site';

export default function EspacoEscutaTransicaoPage() {
  return (
    <Layout>
      <SeoHead
        title="Espaço de Escuta"
        description="Informações sobre o Espaço de Escuta público da Clínica Recriar, em fase de implantação segura."
        path="/escuta"
      />

      <section className="py-16 md:py-24">
        <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Canal Institucional"
            title="Espaço de Escuta"
            description="Um canal público dedicado a pacientes, familiares, responsáveis e visitantes para envio de elogios, sugestões, reclamações e dúvidas institucionais."
          />

          <div className="mt-10 space-y-6 rounded-organic border border-sand-dark/60 bg-white p-8 shadow-soft md:p-10">
            <div className="flex items-start gap-4">
              <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sage-100 text-brand">
                <MessageSquare className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-serif text-2xl font-semibold text-brand-dark">
                  Formulário digital em implantação segura
                </h2>
                <p className="mt-2 leading-relaxed text-earth-body">
                  Estamos concluindo a infraestrutura segura de recebimento e proteção de dados
                  do formulário online do Espaço de Escuta (com opção de envio com ou sem
                  identificação e tratamento restrito à direção da clínica). Por responsabilidade
                  com a sua privacidade, o formulário só será disponibilizado após a conclusão
                  integral dessa etapa.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-sage-200 bg-sage-50 p-5 text-sm text-earth-body">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                <div className="space-y-1.5">
                  <p className="font-semibold text-brand-dark">
                    Finalidade e limites deste canal
                  </p>
                  <p className="leading-relaxed">
                    O Espaço de Escuta tem finalidade exclusivamente institucional. Ele não
                    funciona como prontuário clínico, atendimento psicológico ou serviço de
                    emergência. Em situações de urgência ou crise, procure os serviços públicos
                    de emergência (SAMU 192, UPA/Pronto-Socorro ou CVV 188).
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-sand-dark/60 bg-cream-soft p-5 text-sm text-earth-body">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-terracotta-dark" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-brand-dark">
                    Deseja falar com a clínica agora?
                  </p>
                  <p className="mt-1">
                    Enquanto o formulário online é finalizado, você pode entrar em contato pelo
                    e-mail{' '}
                    <a
                      href={`mailto:${SITE_CONFIG.email}`}
                      className="font-semibold text-brand underline"
                    >
                      {SITE_CONFIG.email}
                    </a>{' '}
                    ou pelo WhatsApp{' '}
                    <a
                      href={criarLinkWhatsapp('Olá, gostaria de encaminhar uma mensagem à direção da Clínica Recriar.')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-brand underline"
                    >
                      {SITE_CONFIG.telefoneExibicao}
                    </a>
                    .
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Link
                href="/privacidade"
                className="text-sm font-semibold text-brand underline underline-offset-4 hover:text-brand-dark"
              >
                Consultar Aviso de Privacidade
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}