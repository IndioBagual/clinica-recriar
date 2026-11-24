export function obterAreaProfissional(cargo = '') {
  const normalizado = cargo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalizado.includes('psicopedagog')) return 'Psicopedagogia';
  if (normalizado.includes('psicolog')) return 'Psicologia';
  if (normalizado.includes('nutricion')) return 'Nutrição';
  if (normalizado.includes('fonoaudiolog')) return 'Fonoaudiologia';

  return cargo || 'Outras áreas';
}