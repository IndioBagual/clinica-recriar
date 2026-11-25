import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { buildVerifiedPgConfig, runControlledTlsProbe, withVerifiedCliPg } from './lib/pg-cli.mjs';

function loadEnvLocalIfPresent() {
  if (!fs.existsSync('.env.local')) return;
  const lines = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

export function parseBootstrapArgs(argv) {
  const args = { email: '', nome: '', recover: false, verifyTls: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--email' && argv[i + 1]) args.email = argv[++i].trim().toLowerCase();
    else if (a === '--nome' && argv[i + 1]) args.nome = argv[++i].trim();
    else if (a === '--recover') args.recover = true;
    else if (a === '--verify-tls') args.verifyTls = true;
  }
  return args;
}

async function main() {
  loadEnvLocalIfPresent();
  const args = parseBootstrapArgs(process.argv.slice(2));

  if (args.verifyTls) {
    const result = await runControlledTlsProbe(process.env);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!args.email || !args.email.includes('@') || args.nome.length < 2) {
    throw new Error('Uso: node scripts/bootstrap-admin-principal.mjs --email <email> --nome "<Nome>" [--recover]');
  }

  buildVerifiedPgConfig(process.env);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY sao obrigatorios');
  }

  const rl = readline.createInterface({ input, output });
  try {
    const confirm = await rl.question(
      `Confirmar bootstrap do Administrador Principal (${args.nome} <${args.email}>, recover=${args.recover})? Digite CONFIRMAR: `
    );
    if (confirm.trim() !== 'CONFIRMAR') {
      console.log('Operacao cancelada pelo operador.');
      return;
    }
  } finally {
    rl.close();
  }

  const state = await withVerifiedCliPg(async (client) => {
    const { rows } = await client.query(
      'SELECT private.acquire_bootstrap_admin($1, $2, $3) AS estado',
      [args.email, args.nome, args.recover]
    );
    return rows[0]?.estado;
  });
  console.log(`Trava de bootstrap adquirida: ${state}`);

  let userId = await withVerifiedCliPg(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM auth.users WHERE email IS NOT NULL AND pg_catalog.lower(pg_catalog.btrim(email)) = $1 AND deleted_at IS NULL',
      [args.email]
    );
    return rows[0]?.id ?? null;
  });

  if (!userId) {
    const adminAuth = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const { data, error } = await adminAuth.auth.admin.inviteUserByEmail(args.email, {
      redirectTo: `${siteUrl}/gestao/atualizar-senha`,
    });
    if (error || !data?.user?.id) {
      throw new Error(
        `Falha ao comunicar com Supabase Auth (${error?.message || 'resposta invalida'}). Estado mantido em in_progress; reexecute com --recover --email ${args.email}.`
      );
    }
    userId = data.user.id;
  }

  await withVerifiedCliPg(async (client) => {
    await client.query('SELECT private.complete_bootstrap_admin($1, $2, $3)', [
      userId,
      args.email,
      args.nome,
    ]);
  });

  console.log(`Bootstrap concluido com sucesso para user_id=${userId}.`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('bootstrap-admin-principal.mjs')) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}