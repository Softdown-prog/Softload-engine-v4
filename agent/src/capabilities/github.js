/**
 * GithubCapability: placeholder para operações futuras de GitHub
 * (issues, pull requests, dados de repositório — ver TASK_MAP no
 * TaskRouter: "github.issue", "github.pull_request",
 * "github.repository").
 *
 * Já verifica permissão antes de qualquer coisa, então mesmo sem
 * implementação real, o controle de acesso já está em vigor: se
 * `permissions.require()` barrar a ação, o erro de "não
 * implementada" nem chega a ser lançado.
 */
export class GithubCapability {
  constructor({ permissions }) {
    this.permissions = permissions;
  }

  async execute(task) {
    this.permissions.require(task.type);

    throw new Error(
      `GitHub capability ainda não implementada: ${task.type}`,
    );
  }
}
