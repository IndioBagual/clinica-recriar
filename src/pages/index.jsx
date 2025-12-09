import Head from 'next/head';
import Link from 'next/link';
import { MapPin, Building2 } from 'lucide-react';

export default function Welcome() {
  return (
    <div className="relative h-screen w-full overflow-hidden font-sans">
      <Head>
        <title>Bem-vindo | Clínica Recriar</title>
      </Head>

      {/* Background */}
      <div className="absolute inset-0 bg-cover bg-center z-0" style={{ backgroundImage: 'url(/img/frente.jpg)' }}>
        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center h-full w-full px-4 sm:px-6">
        
        <div className="text-center mb-12 max-w-2xl mx-auto">
          {/* Logo */}
          <img src="/img/Logo recriar.png" alt="Clínica Recriar" className="w-64 mx-auto mb-8 drop-shadow-sm" />
          
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-800 mb-2">Bem-vindo à Recriar</h1>
          <p className="text-lg md:text-xl font-medium text-brand">Selecione a unidade desejada para atendimento:</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
            
            {/* Cartão Unidade Canabarro */}
            <Link href="/home" className="group bg-white p-10 rounded-2xl shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 border-2 border-transparent hover:border-brand flex flex-col items-center text-center gap-4">
                <div className="text-brand group-hover:scale-110 transition-transform duration-300">
                    <MapPin className="w-16 h-16" />
                </div>
                
                <span className="text-2xl font-bold text-brand-dark group-hover:text-brand transition-colors">Unidade Canabarro</span>
                
                <p className="text-gray-500 text-sm leading-relaxed max-w-[200px]">
                    Rua General Canabarro, 458<br/>
                    Centro, Rio Grande - RS
                </p>
                
                <span className="mt-4 px-6 py-2 bg-brand text-white rounded-full font-bold text-sm shadow-md group-hover:bg-brand-dark transition-colors">
                    Acessar Unidade
                </span>
            </Link>

            {/* Cartão Unidade Abreu (Agora Ativo!) */}
            <Link href="/unidade-abreu" className="group bg-white p-10 rounded-2xl shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 border-2 border-transparent hover:border-brand flex flex-col items-center text-center gap-4">
                <div className="text-brand group-hover:scale-110 transition-transform duration-300">
                    <Building2 className="w-16 h-16" />
                </div>
                
                <span className="text-2xl font-bold text-brand-dark group-hover:text-brand transition-colors">Unidade Abreu</span>
                
                <p className="text-gray-500 text-sm leading-relaxed max-w-[200px]">
                    Rua General Abreu, 52<br/>
                    Cidade Nova, Rio Grande - RS
                </p>
                
                <span className="mt-4 px-6 py-2 bg-brand text-white rounded-full font-bold text-sm shadow-md group-hover:bg-brand-dark transition-colors">
                    Acessar Unidade
                </span>
            </Link>

        </div>
      </div>
    </div>
  );
}