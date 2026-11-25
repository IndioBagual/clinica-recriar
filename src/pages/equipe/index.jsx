import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import SeoHead from '../../components/seo/SeoHead';
import TeamSection from '../../components/TeamSection';

export default function EquipeIndexPage() {
  const router = useRouter();
  const areaQuery = typeof router.query.area === 'string' ? router.query.area : 'Todas';

  return (
    <Layout>
      <SeoHead
        title="Nossa Equipe"
        description="Conheça os profissionais de Psicologia, Nutrição, Psicopedagogia e Fonoaudiologia da Clínica Recriar nas unidades Tiradentes e Abreu."
        path="/equipe"
      />

      <TeamSection
        key={areaQuery}
        areaInicial={areaQuery}
        permitirFiltroUnidade
        permitirBusca
        titulo="Nossa Equipe Multidisciplinar"
        descricao="Filtre por unidade, área de atuação ou pesquise pelo nome e abordagem de cada profissional."
      />
    </Layout>
  );
}