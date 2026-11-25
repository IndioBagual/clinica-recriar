import mapaOtimizado from '../data/imagensOtimizadas.json';

export function resolverImagem(src) {
  if (!src) return '/img/Logo recriar.png';
  return mapaOtimizado[src] || src;
}