import Script from 'next/script';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      {/* 1. Carrega a biblioteca do Google (gtag.js) */}
      <Script
        strategy="afterInteractive"
        src="https://www.googletagmanager.com/gtag/js?id=G-6GT8FRV5GG"
      />

      {/* 2. Configura o Google Analytics */}
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          gtag('config', 'G-6GT8FRV5GG');
        `}
      </Script>

      {/* 3. Renderiza a página */}
      <Component {...pageProps} />
    </>
  );
}