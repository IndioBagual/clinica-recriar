import { MapPin, Phone, Mail } from 'lucide-react';

export default function SectionContato({ unidade = 'Tiradentes' }) {
  // Dados específicos de cada unidade
  const dados = {
    Tiradentes: {
      endereco: 'Rua Tiradentes, 20, Rio Grande, Cidade Nova, CEP 96211-080',
      mapaLink: 'https://maps.app.goo.gl/e5gR6cdYBhh336rR6', // Lembre-se de atualizar com o link novo do Google Maps
      mapaSrc: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d6764.258740564183!2d-52.107571623630086!3d-32.038689526611776!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x95119c09954a74d9%3A0x55f925d82ada53af!2sR.%20Tiradentes%2C%2020%20-%20Cidade%20Nova%2C%20Rio%20Grande%20-%20RS%2C%2096211-080!5e0!3m2!1spt-BR!2sbr!4v1780942209820!5m2!1spt-BR!2sbr",  // Lembre-se de atualizar com o iframe novo do Google Maps
      whatsapp: '5553991281500'
    },
    Abreu: {
      endereco: 'Rua General Abreu, 52 - Bairro Cidade Nova, Rio Grande, RS',
      mapaLink: 'https://maps.app.goo.gl/AMDchxDPA7D3r5Y27', 
      mapaSrc: "https://maps.google.com/maps?q=Rua%20General%20Abreu%2C%2052%20-%20Bairro%20Cidade%20Nova%2C%20Rio%20Grande%20-%20RS&t=&z=15&ie=UTF8&iwloc=&output=embed",
      whatsapp: '5553991281500'
    }
  };

  const infoAtual = dados[unidade] || dados['Tiradentes'];

  return (
    <section id="contato" className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          {/* Coluna da Esquerda: Informações */}
          <div className="text-left order-2 lg:order-1">
            <h2 className="text-4xl font-extrabold text-brand-dark mb-6">Pronto para Recomeçar?</h2>
            <p className="text-xl text-gray-500 mb-8">
              Entre em contato conosco para agendar sua primeira consulta. Estamos aqui para ouvir você.
            </p>
            
            <div className="flex flex-col gap-6">
              {/* Endereço */}
              <a 
                href={infoAtual.mapaLink} 
                target="_blank" 
                rel="noreferrer" 
                className="flex items-start gap-4 text-gray-700 hover:text-brand transition-colors group"
              >
                <MapPin className="w-6 h-6 text-brand group-hover:scale-110 transition-transform mt-1" />
                <span className="max-w-xs">{infoAtual.endereco}</span>
              </a>
              
              {/* WhatsApp */}
              <a 
                href={`https://api.whatsapp.com/send/?phone=${infoAtual.whatsapp}`} 
                target="_blank" 
                rel="noreferrer" 
                className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group"
              >
                <img src="/img/Whatsapp.png" alt="Whatsapp" className="w-6 h-6 group-hover:scale-110 transition-transform" />
                <span>(53) 99128-1500</span>
              </a>

              {/* Email */}
              <a 
                href="mailto:clinicarecriar.rg@gmail.com" 
                className="flex items-center gap-4 text-gray-700 hover:text-brand transition-colors group"
              >
                <Mail className="w-6 h-6 text-brand group-hover:scale-110 transition-transform" />
                <span>clinicarecriar.rg@gmail.com</span>
              </a>
            </div>

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

          {/* Coluna da Direita: Mapa do Google */}
          <div className="order-1 lg:order-2 h-[400px] w-full bg-gray-100 rounded-2xl overflow-hidden shadow-lg border border-gray-200">
             <iframe
               width="100%"
               height="100%"
               style={{ border: 0 }}
               loading="lazy"
               allowFullScreen
               referrerPolicy="no-referrer-when-downgrade"
               src={infoAtual.mapaSrc}
               title={`Mapa da Unidade ${unidade}`}
             ></iframe>
          </div>

        </div>
      </div>
    </section>
  );
}