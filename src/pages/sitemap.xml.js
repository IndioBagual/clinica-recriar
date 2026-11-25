import { SITE_CONFIG } from '../config/site';
import { profissionais } from '../data/profissionais';

const ROTAS_ESTATICAS = [
  '/',
  '/a-clinica',
  '/unidades',
  '/unidades/tiradentes',
  '/unidades/abreu',
  '/equipe',
  '/servicos',
  '/convenios',
  '/escuta',
  '/eventos',
  '/contato',
  '/privacidade',
];

function gerarSitemapXml() {
  const base = SITE_CONFIG.urlBase.replace(/\/$/, '');
  const rotasEquipe = profissionais.map((p) => `/equipe/${p.slug}`);
  const todas = [...ROTAS_ESTATICAS, ...rotasEquipe];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${todas
  .map(
    (rota) => `  <url>
    <loc>${base}${rota === '/' ? '' : rota}</loc>
  </url>`
  )
  .join('\n')}
</urlset>`;
}

export async function getServerSideProps({ res }) {
  const xml = gerarSitemapXml();
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.write(xml);
  res.end();

  return { props: {} };
}

export default function SiteMap() {
  return null;
}