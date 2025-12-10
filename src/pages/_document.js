// src/pages/_document.js
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="pt-br">
      <Head>
        {/* Configuração da Fonte Inter e Ícones */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/png" href="/img/Logo recriar.png" />
      </Head>
      <body className="font-sans text-gray-700 bg-light antialiased selection:bg-brand selection:text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}