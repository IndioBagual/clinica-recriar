import Link from 'next/link';
import { Facebook, Instagram, Mail, MapPin, Phone } from 'lucide-react';

export default function Footer({ unidade = 'Canabarro' }) {
  // Define o endereço com base na unidade
  const endereco = unidade === 'Abreu' 
    ? 'Rua General Abreu, 52' 
    : 'Rua General Canabarro, 458';

  return (
    <footer className="bg-gray-800 text-white py-12 border-t border-gray-700">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Coluna 1: Logo e Slogan */}
          <div className="space-y-4">
            {/* Nota: Usamos a classe brightness e invert para deixar o logo branco */}
            <img 
              src="/img/Logo recriar.png" 
              alt="Logo Clínica Recriar" 
              className="h-10 brightness-0 invert opacity-80" 
            />
            <p className="text-gray-400 text-sm">Cuidado integrado para uma vida plena.</p>
          </div>

          {/* Coluna 2: Navegação */}
          <div>
            <h4 className="text-lg font-bold mb-4 text-white">Navegação</h4>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li><Link href="/#sobre" className="hover:text-brand-light transition">Sobre</Link></li>
              <li><Link href="/#servicos" className="hover:text-brand-light transition">Serviços</Link></li>
              <li><Link href="/#equipe" className="hover:text-brand-light transition">Equipe</Link></li>
              <li><Link href="/#contato" className="hover:text-brand-light transition">Contato</Link></li>
            </ul>
          </div>

          {/* Coluna 3: Contato (Dinâmico) */}
          <div>
            <h4 className="text-lg font-bold mb-4 text-white">Contato</h4>
            <ul className="space-y-3 text-gray-400 text-sm">
              <li className="flex items-start gap-2">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{endereco}</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="w-4 h-4 shrink-0" />
                <span>(53) 99128-1500</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4 shrink-0" />
                <span>clinicarecriar.rg@gmail.com</span>
              </li>
            </ul>
          </div>

          {/* Coluna 4: Redes Sociais */}
          <div>
            <h4 className="text-lg font-bold mb-4 text-white">Siga-nos</h4>
            <div className="flex gap-4">
              <a 
                href="https://www.facebook.com/clinicarecriarrg" 
                target="_blank" 
                rel="noreferrer" 
                className="text-gray-400 hover:text-white transition-colors"
              >
                <Facebook />
              </a>
              <a 
                href="https://www.instagram.com/clinicarecriarrg/" 
                target="_blank" 
                rel="noreferrer" 
                className="text-gray-400 hover:text-white transition-colors"
              >
                <Instagram />
              </a>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-10 pt-6 border-t border-gray-700 text-center text-gray-500 text-sm">
          <p>&copy; {new Date().getFullYear()} Clínica Recriar. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  );
}