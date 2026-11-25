import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionHeading from '../components/ui/SectionHeading';
import { SITE_CONFIG } from '../config/site';

export default function PrivacidadePage() {
  return (
    <Layout>
      <SeoHead
        title="Aviso de Privacidade"
        description="Informações sobre privacidade, dados técnicos de navegação e canais de contato da Clínica Recriar."
        path="/privacidade"
      />

      <section className="py-16 md:py-24">
        <div className="container mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            align="left"
            eyebrow="Privacidade e Transparência"
            title="Aviso de Privacidade"
            description="Informações sobre como este site institucional trata dados técnicos de navegação."
          />

          <div className="mt-10 space-y-6 rounded-organic border border-sand-dark/60 bg-white p-8 text-base leading-relaxed text-earth-body shadow-soft md:p-10">
            <div>
              <h2 className="font-serif text-xl font-semibold text-brand-dark">
                1. Coleta de dados neste site público
              </h2>
              <p className="mt-2">
                Na versão atual, este site possui caráter informativo e não realiza cadastro de
                pacientes nem armazena prontuários ou dados clínicos. Os links de agendamento
                direcionam o visitante para o atendimento via WhatsApp ou e-mail institucional.
              </p>
            </div>

            <div>
              <h2 className="font-serif text-xl font-semibold text-brand-dark">
                2. Métricas de acesso e registros técnicos
              </h2>
              <p className="mt-2">
                Este site utiliza o Google Analytics para métricas agregadas de acesso e é
                hospedado em infraestrutura de nuvem (Netlify), que pode processar registros
                técnicos de rede temporários (como endereço IP, data/hora e navegador) para
                segurança, estabilidade e prevenção a abusos.
              </p>
            </div>

            <div>
              <h2 className="font-serif text-xl font-semibold text-brand-dark">
                3. Contato do controlador
              </h2>
              <p className="mt-2">
                Em caso de dúvidas sobre privacidade ou solicitações relacionadas a dados
                pessoais, entre em contato pelo e-mail{' '}
                <a
                  href={`mailto:${SITE_CONFIG.email}`}
                  className="font-semibold text-brand underline"
                >
                  {SITE_CONFIG.email}
                </a>
                .
              </p>
            </div>

            <p className="border-t border-sand-dark/60 pt-4 text-xs text-earth-muted">
              Nota institucional: este aviso base será complementado e submetido à validação
              jurídica da direção antes da entrada em produção dos módulos com formulário
              próprio (como o Espaço de Escuta).
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}