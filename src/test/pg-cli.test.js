import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVerifiedPgConfig } from '../../scripts/lib/pg-cli.mjs';
import { parseBootstrapArgs } from '../../scripts/bootstrap-admin-principal.mjs';
import { parseTransferArgs } from '../../scripts/transfer-admin-principal.mjs';

describe('scripts/lib/pg-cli.mjs — validacao TLS verify-full', () => {
  let tmpDir;
  let validCaFile;
  let invalidCaFile;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recriar-pg-cli-'));
    validCaFile = path.join(tmpDir, 'ca-valid-format.pem');
    invalidCaFile = path.join(tmpDir, 'ca-invalid.txt');
    fs.writeFileSync(
      validCaFile,
      '-----BEGIN CERTIFICATE-----\nMIIBTEST\n-----END CERTIFICATE-----\n',
      'utf8'
    );
    fs.writeFileSync(invalidCaFile, 'not a pem certificate', 'utf8');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('monta configuracao segura sem connectionString e com rejectUnauthorized=true', () => {
    const cfg = buildVerifiedPgConfig({
      SUPABASE_DB_URL: 'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres?sslmode=verify-full',
      SUPABASE_DB_CA_CERT_PATH: validCaFile,
    });

    expect(cfg).not.toHaveProperty('connectionString');
    expect(cfg.host).toBe('db.exemplo.supabase.co');
    expect(cfg.port).toBe(5432);
    expect(cfg.ssl.rejectUnauthorized).toBe(true);
    expect(cfg.ssl.servername).toBe('db.exemplo.supabase.co');
    expect(cfg.ssl.minVersion).toBe('TLSv1.2');
    expect(typeof cfg.ssl.checkServerIdentity).toBe('function');
  });

  it('rejeita hostname divergente via checkServerIdentity', () => {
    const cfg = buildVerifiedPgConfig({
      SUPABASE_DB_URL: 'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres?sslmode=verify-full',
      SUPABASE_DB_CA_CERT_PATH: validCaFile,
    });

    const err = cfg.ssl.checkServerIdentity('db.exemplo.supabase.co', {
      subject: { CN: 'outro-host.supabase.co' },
      subjectaltname: 'DNS:outro-host.supabase.co',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');

    const ok = cfg.ssl.checkServerIdentity('db.exemplo.supabase.co', {
      subject: { CN: 'db.exemplo.supabase.co' },
      subjectaltname: 'DNS:db.exemplo.supabase.co',
    });
    expect(ok).toBeUndefined();
  });

  it('aborta se NODE_TLS_REJECT_UNAUTHORIZED=0', () => {
    expect(() =>
      buildVerifiedPgConfig({
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        SUPABASE_DB_URL: 'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres?sslmode=verify-full',
        SUPABASE_DB_CA_CERT_PATH: validCaFile,
      })
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED=0/);
  });

  it('rejeita sslmode=require, sslmode=disable e ausencia de sslmode', () => {
    for (const url of [
      'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres?sslmode=require',
      'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres?sslmode=disable',
      'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres',
    ]) {
      expect(() =>
        buildVerifiedPgConfig({ SUPABASE_DB_URL: url, SUPABASE_DB_CA_CERT_PATH: validCaFile })
      ).toThrow(/sslmode=verify-full/);
    }
  });

  it('rejeita CA ausente ou arquivo nao PEM', () => {
    const validUrl = 'postgresql://postgres:secret@db.exemplo.supabase.co:5432/postgres?sslmode=verify-full';
    expect(() =>
      buildVerifiedPgConfig({ SUPABASE_DB_URL: validUrl, SUPABASE_DB_CA_CERT_PATH: path.join(tmpDir, 'nao-existe.pem') })
    ).toThrow(/Certificado CA nao encontrado/);
    expect(() =>
      buildVerifiedPgConfig({ SUPABASE_DB_URL: validUrl, SUPABASE_DB_CA_CERT_PATH: invalidCaFile })
    ).toThrow(/PEM valido/);
  });

  it('faz parse seguro dos argumentos CLI sem acionar operacoes', () => {
    expect(parseBootstrapArgs(['--email', 'Admin@Clinica.br', '--nome', 'Diretoria', '--recover'])).toEqual({
      email: 'admin@clinica.br',
      nome: 'Diretoria',
      recover: true,
      verifyTls: false,
    });
    expect(parseTransferArgs(['--promote', '--target-user-id', '11111111-1111-4111-8111-111111111111'])).toEqual({
      action: 'promote',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      emergencyNoAuth: false,
    });
  });
});