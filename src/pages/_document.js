import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="pt-BR">
      <Head>
        <link rel="icon" type="image/png" href="/img/Logo recriar.png" />
        <meta name="theme-color" content="#1D5C54" />
      </Head>
      <body className="font-sans text-earth-body bg-cream antialiased selection:bg-brand selection:text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}