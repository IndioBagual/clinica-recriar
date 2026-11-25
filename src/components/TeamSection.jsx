import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Search, MapPin } from 'lucide-react';
import { profissionais } from '../data/profissionais';
import { obterAreaProfissional } from '../lib/equipe';
import { resolverImagem } from '../lib/midia';
import Reveal from './Reveal';
import SectionHeading from './ui/SectionHeading';

export default function TeamSection({
  unidadeAtual = null,
  areaInicial = 'Todas',
  permitirFiltroUnidade = false,
  permitirBusca = false,
  titulo = 'Conheça Nossa Equipe',
  descricao = 'Profissionais dedicados e apaixonados pelo que fazem, prontos para acolher você.',
}) {
  const [unidadeSelecionada, setUnidadeSelecionada] = useState(unidadeAtual || 'Todas');
  const [areaSelecionada, setAreaSelecionada] = useState(areaInicial || 'Todas');
  const [termoBusca, setTermoBusca] = useState('');

  const basePorUnidade = useMemo(() => {
    const alvoUnidade = unidadeAtual || (unidadeSelecionada !== 'Todas' ? unidadeSelecionada : null);
    if (!alvoUnidade) return profissionais;
    return profissionais.filter(
      (prof) => Array.isArray(prof.unidades) && prof.unidades.includes(alvoUnidade)
    );
  }, [unidadeAtual, unidadeSelecionada]);

  const areasDisponiveis = useMemo(() => {
    const conjunto = new Set(basePorUnidade.map((p) => obterAreaProfissional(p.cargo)));
    return ['Todas', ...Array.from(conjunto)];
  }, [basePorUnidade]);

  const areaEfetiva = areasDisponiveis.includes(areaSelecionada) ? areaSelecionada : 'Todas';

  const profissionaisExibidos = useMemo(() => {
    const buscaNormalizada = termoBusca
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return basePorUnidade.filter((prof) => {
      const correspondeArea =
        areaEfetiva === 'Todas' || obterAreaProfissional(prof.cargo) === areaEfetiva;

      if (!correspondeArea) return false;
      if (!buscaNormalizada) return true;

      const textoPesquisavel = [
        prof.nome,
        prof.cargo,
        prof.registro,
        ...(prof.especialidades || []),
      ]
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

      return textoPesquisavel.includes(buscaNormalizada);
    });
  }, [basePorUnidade, areaEfetiva, termoBusca]);

  return (
    <section id="equipe" className="bg-cream py-20 md:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow={unidadeAtual ? `Equipe · Unidade ${unidadeAtual}` : 'Corpo Clínico'}
          title={titulo}
          description={descricao}
        />

        <div className="mt-10 flex flex-col items-center gap-5">
          {permitirBusca && (
            <div className="relative w-full max-w-md">
              <label htmlFor="busca-equipe" className="sr-only">
                Buscar profissional por nome ou especialidade
              </label>
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-earth-muted"
                aria-hidden="true"
              />
              <input
                id="busca-equipe"
                type="search"
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder="Buscar por nome, abordagem ou especialidade..."
                className="w-full rounded-full border border-sand-dark bg-white py-3 pl-11 pr-4 text-sm text-earth placeholder:text-earth-muted shadow-soft"
              />
            </div>
          )}

          {permitirFiltroUnidade && !unidadeAtual && (
            <div
              role="group"
              aria-label="Filtrar por unidade"
              className="flex flex-wrap justify-center gap-2"
            >
              {['Todas', 'Tiradentes', 'Abreu'].map((un) => (
                <button
                  key={un}
                  type="button"
                  onClick={() => setUnidadeSelecionada(un)}
                  aria-pressed={unidadeSelecionada === un}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    unidadeSelecionada === un
                      ? 'bg-brand-dark text-white'
                      : 'border border-sand-dark bg-white text-earth-body hover:border-brand hover:text-brand'
                  }`}
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {un === 'Todas' ? 'Todas as unidades' : `Unidade ${un}`}
                </button>
              ))}
            </div>
          )}

          <div
            role="group"
            aria-label="Filtrar por área de atuação"
            className="flex flex-wrap justify-center gap-2.5"
          >
            {areasDisponiveis.map((area) => (
              <button
                key={area}
                type="button"
                onClick={() => setAreaSelecionada(area)}
                aria-pressed={areaEfetiva === area}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                  areaEfetiva === area
                    ? 'bg-brand text-white shadow-soft'
                    : 'border border-sage-300 bg-sage-50 text-brand-dark hover:bg-sage-100'
                }`}
              >
                {area}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-earth-muted" aria-live="polite">
          Exibindo {profissionaisExibidos.length}{' '}
          {profissionaisExibidos.length === 1 ? 'profissional' : 'profissionais'}
        </p>

        {profissionaisExibidos.length === 0 ? (
          <div className="mx-auto mt-10 max-w-lg rounded-organic border border-sand-dark bg-white p-8 text-center">
            <p className="font-serif text-xl font-semibold text-brand-dark">
              Nenhum profissional encontrado com esse filtro
            </p>
            <p className="mt-2 text-sm text-earth-muted">
              Tente limpar a busca ou selecionar outra área ou unidade.
            </p>
            <button
              type="button"
              onClick={() => {
                setAreaSelecionada('Todas');
                if (!unidadeAtual) setUnidadeSelecionada('Todas');
                setTermoBusca('');
              }}
              className="mt-5 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {profissionaisExibidos.map((prof, index) => {
              const isEmBreve = prof.status === 'Em breve';
              const fotoSrc = resolverImagem(prof.foto);

              return (
                <Reveal key={prof.slug} delay={(index % 6) * 0.05}>
                  <Link
                    href={`/equipe/${prof.slug}`}
                    className="group flex h-full flex-col items-center rounded-organic border border-sand-dark/60 bg-white p-7 text-center shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-sage-300 hover:shadow-card"
                  >
                    <div className="relative mb-5 h-44 w-44 overflow-hidden rounded-full border-4 border-sage-100 shadow-sm transition-all group-hover:border-brand/40">
                      <Image
                        src={fotoSrc}
                        alt={`Foto de ${prof.nome}`}
                        fill
                        sizes="(max-width: 640px) 176px, 176px"
                        className={`object-cover object-top transition-transform duration-500 group-hover:scale-105 ${
                          isEmBreve ? 'grayscale opacity-80' : ''
                        }`}
                      />
                      {isEmBreve && (
                        <div className="absolute inset-x-0 bottom-0 bg-brand-dark/85 py-1.5 text-center text-xs font-bold uppercase tracking-widest text-white">
                          Em breve
                        </div>
                      )}
                    </div>

                    <h3 className="font-serif text-xl font-semibold text-brand-dark group-hover:text-brand transition-colors">
                      {prof.nome}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-terracotta-dark">
                      {prof.cargo}
                    </p>
                    <p className="mt-1 text-xs font-medium text-earth-muted">
                      {prof.registro}
                    </p>

                    {!unidadeAtual && Array.isArray(prof.unidades) && prof.unidades.length > 0 && (
                      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                        {prof.unidades.map((un) => (
                          <span
                            key={un}
                            className="rounded-full bg-sage-50 px-3 py-0.5 text-xs font-medium text-sage-700"
                          >
                            Unidade {un}
                          </span>
                        ))}
                      </div>
                    )}

                    <span className="mt-5 text-xs font-semibold uppercase tracking-wider text-brand group-hover:underline">
                      Ver perfil completo
                    </span>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}