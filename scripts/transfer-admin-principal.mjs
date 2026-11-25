import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { buildVerifiedPgConfig, withVerifiedCliPg } from './lib/pg-cli.mjs';

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

export function parseTransferArgs(argv) {
  const args = { action: '', targetUserId: '', emergencyNoAuth: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--promote') args.action = 'promote';
    else if (a === '--demote') args.action = 'demote';
    else if (a === '--target-user-id' && argv[i + 1]) args.targetUserId = argv[++i].trim();
    else if (a === '--emergency-no-auth') args.emergencyNoAuth = true;
  }
  return args;
}

async function promptHidden(promptLabel) {
  const rl = readline.createInterface({ input, output });
  try {
    // Em terminais interativos sem mascaramento nativo do readline/promises, mantem leitura fora de argv/env
    return (await rl.question(promptLabel)).trim();
  } finally {
    rl.close();
  }
}

async function authenticateOperatorOnCli() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sao obrigatorios');
  }

  const email = (await promptHidden('E-mail do Administrador Principal operador: ')).toLowerCase();
  const password = await promptHidden('Senha do operador (nao salva em logs): ');

  const pubClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
  const { data, error } = await pubClient.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token) {
    throw new Error('Falha na autenticacao do operador no Supabase Auth');
  }

  const { data: userData, error: userErr } = await pubClient.auth.getUser(data.session.access_token);
  await pubClient.auth.signOut().catch(() => {});

  if (userErr || !userData?.user?.id) {
    throw new Error('Nao foi possivel verificar a identidade autenticada do operador');
  }

  // Registrada como identidade declarada no processo CLI (nao comprovacao independente pelo PostgreSQL)
  return userData.user.id;
}

async function main() {
  loadEnvLocalIfPresent();
  const args = parseTransferArgs(process.argv.slice(2));
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!['promote', 'demote'].includes(args.action) || !uuidRe.test(args.targetUserId)) {
    throw new Error(
      'Uso: node scripts/transfer-admin-principal.mjs (--promote|--demote) --target-user-id <uuid> [--emergency-no-auth]'
    );
  }

  buildVerifiedPgConfig(process.env);

  let declaredAdminId = null;
  if (!args.emergencyNoAuth) {
    declaredAdminId = await authenticateOperatorOnCli();
  }

  const confirm = await promptHidden(
    `Confirmar ${args.action} em target=${args.targetUserId} (operador_declarado=${declaredAdminId ?? 'emergencia'})? Digite CONFIRMAR: `
  );
  if (confirm !== 'CONFIRMAR') {
    console.log('Operacao cancelada pelo operador.');
    return;
  }

  const sql =
    args.action === 'promote'
      ? 'SELECT private.promote_admin_principal($1, $2)'
      : 'SELECT private.demote_admin_principal($1, $2)';

  await withVerifiedCliPg(async (client) => {
    await client.query(sql, [args.targetUserId, declaredAdminId]);
  });

  console.log(`Operacao ${args.action} concluida para target=${args.targetUserId}.`);
}

if (process.argv[1]?.endsWith('transfer-admin-principal.mjs')) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}