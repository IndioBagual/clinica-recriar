import Layout from '../components/Layout';
import SeoHead from '../components/seo/SeoHead';
import SectionContato from '../components/SectionContato';

export default function ContatoPage() {
  return (
    <Layout>
      <SeoHead
        title="Unidades e Contato"
        description="Endereços, mapas, WhatsApp e e-mail das unidades Tiradentes e Abreu da Clínica Recriar em Rio Grande - RS."
        path="/contato"
      />
      <SectionContato />
    </Layout>
  );
}