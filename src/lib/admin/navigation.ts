import type { AccountLifecycleStatus } from './accountLifecycle';
import type { Phase2Permission } from './schemas';

export interface AdminViewer {
  id: string;
  nome: string;
  email: string;
  isAdminPrincipal: boolean;
  permissions: Phase2Permission[];
  lifecycleStatus: AccountLifecycleStatus;
  conviteSolicitadoEm: string | null;
  emailConfirmadoEm: string | null;
  configuracaoInicialReportadaEm: string | null;
  primeiroAcessoObservadoEm: string | null;
  ultimoAcessoAuthEm: string | null;
  criadoEm: string;
}

export interface ManagedUserRow {
  id: string;
  nome: string;
  email: string;
  is_admin_principal: boolean;
  ativo: boolean;
  estado_ativacao_versao: number;
  convite_solicitado_em: string | null;
  email_confirmado_em: string | null;
  configuracao_inicial_reportada_em: string | null;
  primeiro_acesso_observado_em: string | null;
  ultimo_acesso_auth_em: string | null;
  desativado_em: string | null;
  criado_em: string;
  permissoes: string[];
  lifecycleStatus: AccountLifecycleStatus;
  podeReenviarAcesso: boolean;
}

export interface AuditLogRow {
  id: string;
  ator_tipo: 'usuario' | 'sistema' | 'cli_operador_db' | 'cli_bootstrap';
  usuario_id: string | null;
  ator_sistema: string | null;
  confiabilidade: 'verificado_banco' | 'correlacionado_auth' | 'reportado_aplicacao';
  acao: string;
  recurso_entidade: string;
  recurso_id: string | null;
  resultado: 'sucesso' | 'negado' | 'erro';
  codigo_motivo: string | null;
  metadados: Record<string, unknown>;
  criado_em: string;
}

export interface AdminNavItem {
  href: '/gestao' | '/gestao/usuarios' | '/gestao/auditoria' | '/gestao/minha-conta';
  label: string;
  description: string;
  requiredPermission?: Phase2Permission;
}

const ALL_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    href: '/gestao',
    label: 'Visão geral',
    description: 'Resumo e atalhos conforme suas permissões',
  },
  {
    href: '/gestao/usuarios',
    label: 'Usuários',
    description: 'Contas administrativas, convites e permissões',
    requiredPermission: 'usuarios.manage',
  },
  {
    href: '/gestao/auditoria',
    label: 'Auditoria',
    description: 'Trilha de registros administrativos e confiabilidade',
    requiredPermission: 'auditoria.read',
  },
  {
    href: '/gestao/minha-conta',
    label: 'Minha conta',
    description: 'Dados do perfil, senha e encerramento de sessão',
  },
];

export function hasViewerPermission(
  viewer: Pick<AdminViewer, 'isAdminPrincipal' | 'permissions'>,
  permission: Phase2Permission
): boolean {
  return viewer.isAdminPrincipal || viewer.permissions.includes(permission);
}

/**
 * Ocultacao visual de menu apenas para ergonomia; a autorizacao real permanece nos guards SSR,
 * API Routes e politicas RLS do PostgreSQL.
 */
export function getAuthorizedNavigation(
  viewer: Pick<AdminViewer, 'isAdminPrincipal' | 'permissions'>
): AdminNavItem[] {
  return ALL_NAV_ITEMS.filter(
    (item) => !item.requiredPermission || hasViewerPermission(viewer, item.requiredPermission)
  );
}

export function canEditUserName(
  viewer: Pick<AdminViewer, 'isAdminPrincipal' | 'permissions'>,
  target: Pick<ManagedUserRow, 'is_admin_principal'>
): boolean {
  if (!hasViewerPermission(viewer, 'usuarios.manage')) return false;
  if (target.is_admin_principal && !viewer.isAdminPrincipal) return false;
  return true;
}

export function canToggleUserStatus(
  viewer: Pick<AdminViewer, 'id' | 'isAdminPrincipal' | 'permissions'>,
  target: Pick<ManagedUserRow, 'id' | 'is_admin_principal'>
): boolean {
  if (!hasViewerPermission(viewer, 'usuarios.manage')) return false;
  if (target.id === viewer.id) return false;
  if (target.is_admin_principal && !viewer.isAdminPrincipal) return false;
  return true;
}

export function canManageUserPermissions(
  viewer: Pick<AdminViewer, 'id' | 'isAdminPrincipal'>,
  target: Pick<ManagedUserRow, 'id' | 'is_admin_principal'>
): boolean {
  // Fase 2: usuarios.manage e auditoria.read sao nao delegaveis (exclusivo Admin Principal),
  // bloqueado para si proprio e para outros Administradores Principais.
  return viewer.isAdminPrincipal && target.id !== viewer.id && !target.is_admin_principal;
}

export function formatDateTimePtBr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  BOOTSTRAP_ADMIN_PRINCIPAL: 'Bootstrap de Administrador Principal',
  ADMIN_PRINCIPAL_PROMOTED: 'Promoção a Administrador Principal (CLI)',
  ADMIN_PRINCIPAL_DEMOTED: 'Rebaixamento de Administrador Principal (CLI)',
  USER_PROFILE_CREATED: 'Perfil administrativo criado',
  USER_ACCESS_LINK_REQUESTED: 'Link de acesso solicitado',
  USER_UPDATED: 'Perfil atualizado',
  USER_DEACTIVATED: 'Conta desativada',
  USER_REACTIVATED: 'Conta reativada',
  PERMISSION_GRANTED: 'Permissão concedida',
  PERMISSION_REVOKED: 'Permissão revogada',
  AUTH_SYNC_MANUAL_RETRY_REQUESTED: 'Nova sincronização solicitada',
  AUTH_SYNC_LEASE_EXHAUSTED: 'Sincronização expirada (limite de tentativas)',
  AUTH_SYNC_STALE_RECONCILE_ENQUEUED: 'Reconciliação de versão obsoleta enfileirada',
  AUTH_SYNC_STALE_CLAIM_DETECTED: 'Claim expirado detectado na outbox',
  AUTH_SYNC_FAILURE_REPORTED: 'Falha de sincronização reportada',
  AUTH_DRIFT_REPORTED: 'Divergência de estado Auth reportada',
  AUTH_DRIFT_CORRECTION_REPORTED: 'Correção de divergência reportada',
  AUTH_LOGIN_RECORDED: 'Login autenticado registrado',
  INITIAL_SETUP_REPORTED: 'Configuração inicial reportada',
  AUTH_LOGOUT_REPORTED: 'Logout reportado',
  AUTH_PASSWORD_UPDATE_REPORTED: 'Alteração de senha reportada',
  AUDIT_LOG_VIEWED_REPORTED: 'Consulta à auditoria reportada',
  ACCESS_DENIED: 'Acesso negado',
  AUTH_LOGIN_FAILED: 'Tentativa de login negada',
  AUTH_PASSWORD_RESET_REQUEST: 'Solicitação de recuperação de senha',
};