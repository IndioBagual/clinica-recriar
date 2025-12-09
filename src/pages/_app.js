// src/pages/_app.js
import '../styles/globals.css'; // Importa o Tailwind e estilos globais

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}