import Head from 'next/head';
import { SITE_CONFIG } from '../../config/site';

export default function SeoHead({
  title,
  description = 'Clínica Recriar em Rio Grande - RS. Atendimento multidisciplinar em Psicologia, Psicopedagogia, Nutrição e Fonoaudiologia nas unidades Tiradentes e Abreu.',
  path = '/',
  noIndex = false,
  jsonLd = null,
}) {
  const fullTitle = title ? `${title} | ${SITE_CONFIG.nome}` : SITE_CONFIG.nome;
  const canonicalUrl = `${SITE_CONFIG.urlBase}${path === '/' ? '' : path}`;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      <meta property="og:type" content="website" />
      <meta property="og:locale" content="pt_BR" />
      <meta property="og:site_name" content={SITE_CONFIG.nome} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta
        property="og:image"
        content={`${SITE_CONFIG.urlBase}${SITE_CONFIG.imagemFachadaPrincipal}`}
      />

      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </Head>
  );
}