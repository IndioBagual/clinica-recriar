import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { profissionais } from '../data/profissionais';
import Reveal from './Reveal';

export default function TeamSection({ unidadeAtual }) {
  const [filtro, setFiltro] = useState('Todos');

  // 1. Filtra primeiro pela unidade (Canabarro ou Abreu)
  const profissionaisDaUnidade = profissionais.filter(prof => 
    prof.unidades && prof.unidades.includes(unidadeAtual)
  );

  // 2. Filtra depois pelo botão clicado (Psicóloga, Nutricionista, etc.)
  const profissionaisExibidos = filtro === 'Todos' 
    ? profissionaisDaUnidade 
    : profissionaisDaUnidade.filter(prof => prof.cargo.includes(filtro));

  // Lista de cargos únicos para criar os botões de filtro automaticamente
  const cargos = ['Todos', ...new Set(profissionaisDaUnidade.map(p => p.cargo))];

  return (
    <section id="equipe" className="py-20 bg-white">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-extrabold text-brand-dark mb-4">Conheça Nossa Equipe</h2>
          <p className="text-lg text-gray-500 max-w-3xl mx-auto">
            Profissionais dedicados e apaixonados pelo que fazem, prontos para acolher você.
          </p>
        </div>

        {/* Botões de Filtro */}
        <div className="flex flex-wrap justify-center gap-3 mb-12">
          {cargos.map((cargo) => (
            <button
              key={cargo}
              onClick={() => setFiltro(cargo)}
              className={`px-6 py-2 rounded-lg font-semibold transition-all border border-brand
                ${filtro === cargo 
                  ? 'bg-brand text-white shadow-md' 
                  : 'bg-transparent text-brand hover:bg-brand hover:text-white'
                }`}
            >
              {cargo}
            </button>
          ))}
        </div>

        {/* Grid de Profissionais */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {profissionaisExibidos.map((prof, index) => (
            <Reveal key={prof.slug} delay={index * 0.1}>
              <Link 
                key={prof.slug} 
                href={`/equipe/${prof.slug}`}
                className="group block hover:scale-105 transition-transform duration-300"
              >
                <div className="text-center p-6 bg-white rounded-2xl hover:shadow-xl transition-shadow border border-transparent hover:border-gray-100 h-full">
                  <div className="relative w-48 h-48 mx-auto mb-6">
                    {/* Imagem otimizada */}
                    <Image 
                      src={prof.foto} 
                      alt={`Foto de ${prof.nome}`}
                      fill
                      className="rounded-full object-cover shadow-lg group-hover:ring-4 group-hover:ring-brand/30 transition-all"
                    />
                  </div>
                  <h3 className="text-xl font-bold text-gray-800">{prof.nome}</h3>
                  <p className="text-brand font-medium">{prof.cargo}</p>
                  <p className="text-sm text-gray-400 mt-1">{prof.registro}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}