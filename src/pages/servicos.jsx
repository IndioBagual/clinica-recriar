import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionServicos from '../components/SectionServicos';
import SectionContato from '../components/SectionContato';

export default function ServicosPage() {
  return (
    <Layout>
      <SeoHead
        title="Especialidades e Serviços"
        description="Psicologia, Psicopedagogia, Nutrição e Fonoaudiologia na Clínica Recriar em Rio Grande - RS."
        path="/servicos"
      />
      <SectionServicos />
      <SectionContato />
    </Layout>
  );
}