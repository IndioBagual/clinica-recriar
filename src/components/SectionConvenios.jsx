import Reveal from "./Reveal";

export default function SectionConvenios() {
  return (
    <section id="convenios" className="py-20 bg-light">
      <div className="container mx-auto px-6">
        <Reveal delay={0.1}>  
          <div className="text-center mb-12">
            <h2 className="text-4xl font-extrabold text-brand-dark mb-4">Convênios Atendidos</h2>
            <p className="text-lg text-gray-500">Confira a lista de convênios que atendemos.</p>
          </div>
        </Reveal>
      <Reveal delay={0.2}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 justify-items-center items-center max-w-4xl mx-auto">
          {/* Nota: Certifique-se que estas imagens estão na pasta public/img/ */}
          <img src="/img/unimed.jpg" alt="Unimed" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          <img src="/img/ccg.png" alt="CCG" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          <img src="/img/cabergs.png" alt="Cabergs" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          <img src="/img/doctorclin.png" alt="DoctorClin" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          <img src="/img/postalsaude.png" alt="Postal Saúde" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          <img src="/img/Fusex.png" alt="Fusex" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          <img src="/img/FUSMA.png" alt="FUSMA" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" />
          {/* Adicione o Sulamerica se tiver a imagem: */}
          {/* <img src="/img/sulamerica.png" alt="SulAmérica" className="max-w-[120px] grayscale hover:grayscale-0 hover:scale-110 transition-all duration-300" /> */}
        </div>
      </Reveal> 
      </div>
    </section>
  );
}