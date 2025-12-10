import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import Reveal from './Reveal';

export default function Header({ unidade }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Define para onde os links internos (Sobre, Equipe...) devem apontar
  const baseUrl = unidade === 'Abreu' ? '/unidade-abreu' : '/home';

  // Link do WhatsApp (igual para ambas as unidades conforme os arquivos originais)
  const whatsappLink = "https://api.whatsapp.com/send/?phone=5553991281500&text=Olá+gostaria+de+marcar+uma+consulta.";

  const closeMenu = () => setIsMobileMenuOpen(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md shadow-sm py-3 transition-all">
        <div className="container mx-auto px-6 flex justify-between items-center">
            
            {/* Logo */}
            <Link href="/" className="block">
                <img src="/img/Logo recriar.png" alt="Logo Clínica Recriar" className="h-10 md:h-12" />
            </Link>
            
            {/* Navegação Desktop */}
            <nav className="hidden lg:flex items-center gap-8">
                <Link href={`${baseUrl}#sobre`} className="text-gray-500 font-medium hover:text-brand transition-colors">Sobre Nós</Link>
                <Link href={`${baseUrl}#servicos`} className="text-gray-500 font-medium hover:text-brand transition-colors">Serviços</Link>
                <Link href={`${baseUrl}#equipe`} className="text-gray-500 font-medium hover:text-brand transition-colors">Equipe</Link>
                <Link href={`${baseUrl}#convenios`} className="text-gray-500 font-medium hover:text-brand transition-colors">Convênios</Link>
                <Link href={`${baseUrl}#contato`} className="text-gray-500 font-medium hover:text-brand transition-colors">Contato</Link>
            </nav>

            {/* Botão Desktop (Agora linkando para o WhatsApp) */}
            <a 
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden lg:inline-block bg-accent hover:bg-accent-dark text-white font-bold py-2 px-6 rounded-lg shadow-md hover:scale-105 transition-all"
            >
                Agendar Consulta
            </a>

            {/* Botão Menu Mobile */}
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden text-gray-700 hover:text-brand"
            >
                <Menu className="w-8 h-8" />
            </button>
        </div>
        
        {/* Menu Mobile */}
        {isMobileMenuOpen && (
          <div className="bg-white border-t border-gray-200 absolute w-full left-0 top-full shadow-lg lg:hidden">
              <nav className="flex flex-col items-center gap-4 py-6">
                  <Link href={`${baseUrl}#sobre`} onClick={closeMenu} className="text-gray-600 hover:text-brand">Sobre Nós</Link>
                  <Link href={`${baseUrl}#servicos`} onClick={closeMenu} className="text-gray-600 hover:text-brand">Serviços</Link>
                  <Link href={`${baseUrl}#equipe`} onClick={closeMenu} className="text-gray-600 hover:text-brand">Equipe</Link>
                  <Link href={`${baseUrl}#convenios`} onClick={closeMenu} className="text-gray-600 hover:text-brand">Convênios</Link>
                  <Link href={`${baseUrl}#contato`} onClick={closeMenu} className="text-gray-600 hover:text-brand">Contato</Link>
                  
                  {/* Botão Mobile (Também linkando para o WhatsApp) */}
                  <a 
                    href={whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={closeMenu} 
                    className="mt-2 bg-accent text-white font-bold py-2 px-6 rounded-lg text-center"
                  >
                    Agendar Consulta
                  </a>
              </nav>
          </div>
        )}
    </header>
  );
}