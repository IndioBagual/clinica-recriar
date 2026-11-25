import { z } from 'zod';

export const PHASE2_PERMISSIONS = ['usuarios.manage', 'auditoria.read'] as const;
export type Phase2Permission = (typeof PHASE2_PERMISSIONS)[number];

export const AUDIT_ACTIONS = [
  'BOOTSTRAP_ADMIN_PRINCIPAL',
  'ADMIN_PRINCIPAL_PROMOTED',
  'ADMIN_PRINCIPAL_DEMOTED',
  'USER_PROFILE_CREATED',
  'USER_ACCESS_LINK_REQUESTED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'PERMISSION_GRANTED',
  'PERMISSION_REVOKED',
  'AUTH_SYNC_MANUAL_RETRY_REQUESTED',
  'AUTH_SYNC_LEASE_EXHAUSTED',
  'AUTH_SYNC_STALE_RECONCILE_ENQUEUED',
  'AUTH_SYNC_STALE_CLAIM_DETECTED',
  'AUTH_SYNC_FAILURE_REPORTED',
  'AUTH_DRIFT_REPORTED',
  'AUTH_DRIFT_CORRECTION_REPORTED',
  'AUTH_LOGIN_RECORDED',
  'INITIAL_SETUP_REPORTED',
  'AUTH_LOGOUT_REPORTED',
  'AUTH_PASSWORD_UPDATE_REPORTED',
  'AUDIT_LOG_VIEWED_REPORTED',
  'ACCESS_DENIED',
  'AUTH_LOGIN_FAILED',
  'AUTH_PASSWORD_RESET_REQUEST',
] as const;

const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'E-mail excede o limite permitido.')
  .pipe(z.email('E-mail inválido.'));

const strongPasswordSchema = z
  .string()
  .min(12, 'A senha deve conter no mínimo 12 caracteres.')
  .max(128, 'A senha excede o limite de 128 caracteres.')
  .refine((val) => /[a-z]/.test(val), 'A senha deve conter letra minúscula.')
  .refine((val) => /[A-Z]/.test(val), 'A senha deve conter letra maiúscula.')
  .refine((val) => /[0-9]/.test(val), 'A senha deve conter número.')
  .refine((val) => /[^A-Za-z0-9]/.test(val), 'A senha deve conter caractere especial.');

export const uuidParamSchema = z.uuid('Identificador inválido.');

export const loginSchema = z
  .object({
    email: normalizedEmailSchema,
    password: z.string().min(1, 'Senha obrigatória.').max(128, 'Senha inválida.'),
  })
  .strict();

export const passwordResetRequestSchema = z
  .object({
    email: normalizedEmailSchema,
  })
  .strict();

export const initialPasswordSchema = z
  .object({
    newPassword: strongPasswordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Senha atual obrigatória.').max(128),
    newPassword: strongPasswordSchema,
  })
  .strict()
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'A nova senha deve ser diferente da senha atual.',
    path: ['newPassword'],
  });

export const createUserSchema = z
  .object({
    nome: z.string().trim().min(2, 'Nome muito curto.').max(160, 'Nome excede o limite.'),
    email: normalizedEmailSchema,
  })
  .strict();

export const updateUserNameSchema = z
  .object({
    nome: z.string().trim().min(2, 'Nome muito curto.').max(160, 'Nome excede o limite.'),
  })
  .strict();

export const setUserStatusSchema = z
  .object({
    ativo: z.boolean(),
  })
  .strict();

export const permissionMutationSchema = z
  .object({
    permissao: z.enum(PHASE2_PERMISSIONS),
  })
  .strict();

export const auditQuerySchema = z.object({
  pagina: z.coerce.number().int().min(1).max(10000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
  filtro_acao: z.enum(AUDIT_ACTIONS).optional(),
});