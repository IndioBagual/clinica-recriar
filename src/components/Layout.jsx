import Header from './Header';
import Footer from './Footer';

// O Layout recebe a prop "unidade" (Ex: "Canabarro" ou "Abreu")
export default function Layout({ children, unidade }) {
  return (
    <div className="flex flex-col min-h-screen font-sans text-gray-700 bg-light antialiased selection:bg-brand selection:text-white">
      {/* Passamos a unidade para o Header saber criar os links certos */}
      <Header unidade={unidade} />
      
      <main className="flex-grow pt-32 pb-0">
        {children}
      </main>

      {/* O Footer também usa a unidade para mostrar o endereço certo */}
      <Footer unidade={unidade} />
    </div>
  );
}