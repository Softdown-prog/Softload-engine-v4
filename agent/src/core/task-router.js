/**
 * Permissions: controla quais ações (identificadas pelo mesmo `type`
 * usado no TASK_MAP do TaskRouter) o agent tem autorização para
 * executar.
 *
 * Duas camadas de controle:
 * 1. `mode`: se for "full", TODAS as ações são permitidas,
 *    independente do que estiver no mapa `permissions` (bypass
 *    total — ver observação em `can()`).
 * 2. `permissions`: mapa de allowlist/denylist granular por ação,
 *    usado sempre que `mode` não for "full".
 */
// Configuração padrão de permissões, uma entrada por tipo de task
// suportado (deve ficar em sincronia com o TASK_MAP do TaskRouter).
// Ações potencialmente perigosas ou irreversíveis (delete,
// shell.execute, git.commit, github.*create, artifact.push) vêm
// desabilitadas por padrão — modelo "seguro por padrão" (fail
// closed). Extraído para uma constante de módulo (em vez de ficar
// só dentro do construtor) para que os presets por papel em
// role-permissions.js possam partir dela via spread, sem duplicar a
// lista inteira.
const DEFAULT_PERMISSIONS = {
  "file.read": true,
  "file.write": true,
  "file.delete": false,

  "shell.execute": false,

  "git.status": true,
  "git.diff": true,
  "git.log": true,
  "git.branch": true,
  "git.commit": false,

  "github.issue_create": false,
  "github.issue_get": true,
  "github.pull_request_create": false,
  "github.pull_request_get": true,
  "github.repository_get": true,

  "storage.read": true,
  "storage.write": true,
  "storage.delete": false,
  "storage.list": true,

  "artifact.build": false,
  "artifact.push": false,
  "artifact.list": true,

  // Negado por padrão: só o preset do Orquestrador
  // (createOrchestratorPermissions) libera isto.
  "agent.dispatch": false,
};

/**
 * Permissions: controla quais ações (identificadas pelo mesmo `type`
 * usado no TASK_MAP do TaskRouter) o agent tem autorização para
 * executar.
 *
 * Duas camadas de controle:
 * 1. `mode`: se for "full", TODAS as ações são permitidas,
 *    independente do que estiver no mapa `permissions` (bypass
 *    total — ver observação em `can()`).
 * 2. `permissions`: mapa de allowlist/denylist granular por ação,
 *    usado sempre que `mode` não for "full".
 */
export class Permissions {
  constructor({ mode = "restricted", permissions, role } = {}) {
    // Qualquer valor diferente de "full" se comporta como
    // "restricted" na prática, já que `can()` só faz um check
    // especial para "full" — não há validação/enum de modos aqui.
    this.mode = mode;

    // Rótulo opcional (ex: "explorer", "coder", "validator"), só
    // para facilitar logging/auditoria — não afeta a lógica de
    // permissão em si.
    this.role = role || "default";

    // Permite passar um mapa customizado (ex: um preset por papel,
    // ver role-permissions.js), mesclado sobre o default: qualquer
    // ação não mencionada no override mantém o valor padrão, em vez
    // de precisar redeclarar o mapa inteiro toda vez.
    this.permissions = {
      ...DEFAULT_PERMISSIONS,
      ...(permissions || {}),
    };
  }

  /**
   * Verifica se uma ação é permitida.
   *
   * IMPORTANTE: em modo "full", retorna `true` para QUALQUER ação,
   * sem sequer consultar `this.permissions`. Isso significa que
   * `revoke()` não tem efeito algum enquanto `mode === "full"`.
   */
  can(action) {
    if (this.mode === "full") {
      return true;
    }

    // `=== true` explícito: ações não listadas no mapa retornam
    // `undefined`, que não é `=== true`, então o default para
    // qualquer ação desconhecida é negar (fail closed).
    return this.permissions[action] === true;
  }

  /**
   * Como can(), mas lança um erro (com `code: "PERMISSION_DENIED"`)
   * em vez de retornar false. Útil nas capabilities, que podem
   * chamar `permissions.require("shell.execute")` no início da
   * execução para abortar cedo com um erro padronizado.
   */
  require(action) {
    if (!this.can(action)) {
      const error = new Error(
        `Permissão negada: ${action}`,
      );

      error.code = "PERMISSION_DENIED";

      throw error;
    }
  }

  /**
   * Concede uma permissão em tempo de execução (útil para fluxos
   * onde o usuário aprova uma ação sensível pontualmente).
   * Sem efeito prático se `mode === "full"` (já tudo permitido) —
   * e não altera `mode` em si, então não "promove" o agent, apenas
   * ativa uma entrada específica no mapa.
   */
  grant(action) {
    this.permissions[action] = true;
  }

  /**
   * Revoga uma permissão em tempo de execução.
   * ATENÇÃO: não tem efeito se `mode === "full"`, pois `can()`
   * ignora o mapa `permissions` nesse modo.
   */
  revoke(action) {
    this.permissions[action] = false;
  }

  /**
   * Retorna uma cópia (shallow) do estado atual de permissões,
   * incluindo o modo — útil para logging/auditoria/debug, sem
   * expor a referência ao objeto interno `this.permissions`.
   */
  snapshot() {
    return {
      mode: this.mode,
      role: this.role,
      ...this.permissions,
    };
  }
}
