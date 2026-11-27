import fs from 'node:fs';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { Client } from 'pg';

export function buildVerifiedPgConfig(env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Abortado: NODE_TLS_REJECT_UNAUTHORIZED=0 e proibido no CLI');
  }

  const rawUrl = env.SUPABASE_DB_URL;
  const caPath = env.SUPABASE_DB_CA_CERT_PATH;

  if (!rawUrl || !caPath) {
    throw new Error('SUPABASE_DB_URL e SUPABASE_DB_CA_CERT_PATH sao obrigatorios');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Formato invalido em SUPABASE_DB_URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Protocolo invalido em SUPABASE_DB_URL');
  }

  if (parsed.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('SUPABASE_DB_URL deve especificar explicitamente sslmode=verify-full');
  }

  if (!parsed.hostname) {
    throw new Error('Hostname ausente em SUPABASE_DB_URL');
  }

  if (!fs.existsSync(caPath)) {
    throw new Error(`Certificado CA nao encontrado no caminho informado`);
  }

  const ca = fs.readFileSync(caPath, 'utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Arquivo CA nao contem certificado PEM valido');
  }

  // Passa campos separados (sem connectionString) para impedir override do pg-connection-string
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    connectionTimeoutMillis: 15000,
    ssl: {
      ca,
      rejectUnauthorized: true,
      servername: parsed.hostname,
      minVersion: 'TLSv1.2',
      checkServerIdentity: (hostname, cert) => tls.checkServerIdentity(hostname, cert),
    },
  };
}

export async function connectVerifiedCliPg(env = process.env) {
  const config = buildVerifiedPgConfig(env);
  const client = new Client(config);
  await client.connect();

  try {
    const { rows } = await client.query(
      'SELECT ssl, version, current_user AS papel_atual FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()'
    );
    if (!rows[0] || rows[0].ssl !== true) {
      throw new Error('Handshake concluido sem TLS ativo; conexao encerrada');
    }
    return { client, tlsInfo: rows[0] };
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
}

export async function withVerifiedCliPg(fn, env = process.env) {
  const { client, tlsInfo } = await connectVerifiedCliPg(env);
  try {
    return await fn(client, tlsInfo);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Validacao TLS controlada (somente leitura / sem credenciais reais nas sondas negativas):
 * 1) Conexao legitima com CA oficial + verify-full.
 * 2) Rejeicao de hostname incompativel usando o IP resolvido do proprio host Supabase + credenciais falsas.
 */
export async function runControlledTlsProbe(env = process.env) {
  const config = buildVerifiedPgConfig(env);

  // 1. Conexao legitima
  const legit = await withVerifiedCliPg(async (_client, tlsInfo) => tlsInfo, env);

  // 2. Sonda de hostname incompativel contra o proprio endpoint Supabase (falha no handshake TLS antes da autenticacao)
  const resolved = await dns.lookup(config.host);
  const mismatchClient = new Client({
    host: resolved.address,
    port: config.port,
    database: config.database,
    user: 'tls_hostname_probe',
    password: 'not_a_real_password',
    connectionTimeoutMillis: 10000,
    ssl: {
      ca: config.ssl.ca,
      rejectUnauthorized: true,
      servername: resolved.address,
      minVersion: 'TLSv1.2',
      checkServerIdentity: (hostname, cert) => tls.checkServerIdentity(hostname, cert),
    },
  });

  let mismatchCode = 'UNEXPECTED_SUCCESS';
  try {
    await mismatchClient.connect();
  } catch (err) {
    mismatchCode = err?.code || err?.message || 'TLS_ERROR';
  } finally {
    await mismatchClient.end().catch(() => {});
  }

  return {
    legitTlsActive: legit.ssl === true,
    legitTlsVersion: legit.version,
    legitRole: legit.papel_atual,
    hostnameMismatchRejected: mismatchCode !== 'UNEXPECTED_SUCCESS',
    hostnameMismatchCode: mismatchCode,
  };
}