export interface AccountLifecycleFields {
  ativo: boolean;
  convite_solicitado_em: string | null;
  email_confirmado_em: string | null;
  configuracao_inicial_reportada_em: string | null;
  primeiro_acesso_observado_em: string | null;
  ultimo_acesso_auth_em: string | null;
}

export type AccountLifecycleStatus =
  | 'desativada'
  | 'ativa_acesso_observado'
  | 'configuracao_inicial_reportada'
  | 'email_confirmado_sem_acesso'
  | 'convite_solicitado'
  | 'perfil_criado_sem_convite';

/**
 * Preserva a separacao explicita entre:
 * - convite solicitado;
 * - e-mail confirmado no Auth;
 * - configuracao inicial reportada pela aplicacao (NAO prova troca de senha);
 * - primeiro acesso observado / ultimo acesso informado pelo Auth.
 */
export function deriveAccountLifecycleStatus(fields: AccountLifecycleFields): AccountLifecycleStatus {
  if (!fields.ativo) return 'desativada';
  if (fields.primeiro_acesso_observado_em) return 'ativa_acesso_observado';
  if (fields.configuracao_inicial_reportada_em) return 'configuracao_inicial_reportada';
  if (fields.email_confirmado_em) return 'email_confirmado_sem_acesso';
  if (fields.convite_solicitado_em) return 'convite_solicitado';
  return 'perfil_criado_sem_convite';
}

export function canRequestAccessLink(fields: AccountLifecycleFields): boolean {
  return fields.ativo && fields.primeiro_acesso_observado_em === null;
}