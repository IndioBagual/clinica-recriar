import { MapPin, Phone, Mail } from 'lucide-react';

export default function SectionContato({ unidade = 'Canabarro' }) {
  // Dados específicos de cada unidade
  const dados = {
    Canabarro: {
      endereco: 'Rua General Canabarro, 458 - Centro, Rio Grande, RS',
      mapaLink: 'https://maps.google.com/?q=Rua+General+Canabarro,458,Rio+Grande,RS',
      whatsapp: '5553991281500' // Link principal
    },
    Abreu: {
      endereco: 'Rua General Abreu, 52 - Bairro Cidade Nova, Rio Grande, RS',
      mapaLink: 'https://maps.google.com/?q=Rua+General+Abreu,52,Rio+Grande,RS',
      whatsapp: '5553991281500' // Link principal (ajuste se for diferente)
    }
  };

  const infoAtual = dados[unidade] || dados['Canabarro'];

  return (
    <section id="contato" className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          
          <div className="text-left">
            <h2 className="text-4xl font-extrabold text-brand-dark mb-6">Pronto para Recomeçar?</h2>
            <p className="text-xl text-gray-500 mb-8">
              Entre em contato conosco para agendar sua primeira consulta. Estamos aqui para ouvir você.
            </p>
            
            <div className="flex flex-col gap-6">
              <a href={infoAtual.mapaLink} target="_blank" rel="noreferrer" className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group">
                <MapPin className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" />
                <span>{infoAtual.endereco}</span>
              </a>
              
              <a href={`https://api.whatsapp.com/send/?phone=${infoAtual.whatsapp}`} target="_blank" rel="noreferrer" className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group">
                {/* Ícone do Whatsapp (Imagem) */}
                <img src="/img/Whatsapp.png" alt="Whatsapp" className="w-6 h-6 group-hover:scale-110 transition-transform" />
                <span>(53) 99128-1500</span>
              </a>

              <a href="mailto:clinicarecriar.rg@gmail.com" className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group">
                <Mail className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" />
                <span>clinicarecriar.rg@gmail.com</span>
              </a>
            </div>

            {/* BOTÃO DE AGENDAR CONSULTA GRANDE */}
            <div className="mt-10">
              <a 
                href={`https://api.whatsapp.com/send/?phone=${infoAtual.whatsapp}`} 
                target="_blank" 
                rel="noreferrer"
                className="bg-brand hover:bg-brand-dark text-white font-bold py-4 px-8 rounded-lg shadow-xl inline-block hover:scale-105 transition-all text-lg"
              >
                Agendar Consulta
              </a>
            </div>
          </div>

          {/* Opcional: Adicionar um Mapa ou Imagem aqui na coluna da direita */}
          <div className="hidden md:block bg-gray-100 rounded-2xl h-80 w-full overflow-hidden shadow-inner flex items-center justify-center text-gray-400">
             {/* Podes substituir por um iframe do Google Maps se quiseres */}
             <MapPin className="w-16 h-16 opacity-20" />
             <span className="ml-2">Mapa da Unidade {unidade}</span>
          </div>

        </div>
      </div>
    </section>
  );
}