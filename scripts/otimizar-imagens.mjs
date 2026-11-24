import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'img', 'otimizadas');
const MAP_OUT = path.join(ROOT, 'src', 'data', 'imagensOtimizadas.json');

const profissionaisRaw = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src', 'data', 'profissionais.json'), 'utf8')
);

const imagensInstitucionais = [
  { src: '/img/fachada-tiradentes.jpg', maxWidth: 1800, quality: 84 },
  { src: '/img/frente.jpg', maxWidth: 1600, quality: 82 },
  { src: '/img/Logo recriar.png', maxWidth: 640, quality: 92 },
  { src: '/img/Whatsapp.png', maxWidth: 128, quality: 90 },
  { src: '/img/unimed.jpg', maxWidth: 360, quality: 88 },
  { src: '/img/ccg.png', maxWidth: 360, quality: 90 },
  { src: '/img/cabergs.png', maxWidth: 360, quality: 90 },
  { src: '/img/doctorclin.png', maxWidth: 360, quality: 90 },
  { src: '/img/postalsaude.png', maxWidth: 360, quality: 90 },
  { src: '/img/Fusex.png', maxWidth: 360, quality: 90 },
  { src: '/img/FUSMA.png', maxWidth: 360, quality: 90 },
];

const imagensEquipe = profissionaisRaw.equipe.map((p) => ({
  src: p.foto,
  maxWidth: 800,
  quality: 84,
}));

const alvos = [...imagensInstitucionais, ...imagensEquipe];

function slugifyFileName(srcPath) {
  const base = path.basename(srcPath, path.extname(srcPath));
  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/²/g, '-2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const mapa = {};
const usados = new Set();
let totalAntes = 0;
let totalDepois = 0;

console.log('| Arquivo Original | Original (KB) | Otimizado (KB) | Economia | Destino |');
console.log('| :--- | ---: | ---: | ---: | :--- |');

for (const item of alvos) {
  if (usados.has(item.src)) continue;
  usados.add(item.src);

  const absIn = path.join(PUBLIC_DIR, item.src.replace(/^\//, ''));
  if (!fs.existsSync(absIn)) {
    console.warn(`AVISO: Arquivo não encontrado: ${item.src}`);
    continue;
  }

  const outName = `${slugifyFileName(item.src)}.webp`;
  const absOut = path.join(OUT_DIR, outName);
  const publicOut = `/img/otimizadas/${outName}`;

  const antesBytes = fs.statSync(absIn).size;

  await sharp(absIn)
    .rotate()
    .resize({ width: item.maxWidth, withoutEnlargement: true })
    .webp({ quality: item.quality, effort: 5 })
    .toFile(absOut);

  const depoisBytes = fs.statSync(absOut).size;
  totalAntes += antesBytes;

  if (depoisBytes >= antesBytes) {
    fs.unlinkSync(absOut);
    totalDepois += antesBytes;
    console.log(
      `| ${item.src} | ${(antesBytes / 1024).toFixed(1)} | ${(antesBytes / 1024).toFixed(1)} | 0.0% (original mantido) | ${item.src} |`
    );
    continue;
  }

  totalDepois += depoisBytes;
  const economia = ((1 - depoisBytes / antesBytes) * 100).toFixed(1);
  mapa[item.src] = publicOut;

  console.log(
    `| ${item.src} | ${(antesBytes / 1024).toFixed(1)} | ${(depoisBytes / 1024).toFixed(1)} | ${economia}% | ${publicOut} |`
  );
}

fs.writeFileSync(MAP_OUT, JSON.stringify(mapa, null, 2) + '\n', 'utf8');

const economiaTotal = totalAntes > 0 ? ((1 - totalDepois / totalAntes) * 100).toFixed(1) : '0.0';
console.log(`\nTotal original: ${(totalAntes / 1024 / 1024).toFixed(2)} MB`);
console.log(`Total efetivo servido: ${(totalDepois / 1024 / 1024).toFixed(2)} MB (economia de ${economiaTotal}%)`);