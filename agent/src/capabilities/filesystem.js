import fs from "node:fs/promises";

/**
 * FileSystemCapability: expõe operações de arquivo (ler, escrever,
 * deletar, listar, buscar) ao agent, sempre dentro dos limites do
 * Workspace e respeitando as Permissions configuradas.
 */
export class FileSystemCapability {
  constructor({ workspace, permissions }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  /**
   * Ponto de entrada único, chamado pelo TaskRunner.
   * Verifica permissão ANTES de despachar para o método específico —
   * assim nenhuma operação (mesmo as adicionadas no futuro) escapa
   * do controle de Permissions, desde que passe por este switch.
   */
  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "file.read":
        return this.read(task);

      case "file.write":
        return this.write(task);

      case "file.delete":
        return this.delete(task);

      case "file.list":
        return this.list(task);

      case "file.search":
        return this.search(task);

      default:
        // Não deveria acontecer na prática, já que o TaskRouter só
        // encaminha tipos presentes no TASK_MAP — mas serve como
        // proteção extra caso essa capability seja chamada de outro
        // jeito no futuro.
        throw new Error(
          `Operação filesystem desconhecida: ${task.type}`,
        );
    }
  }

  /**
   * Lê o conteúdo de um arquivo (via Workspace, que já valida que
   * `task.path` fica dentro do diretório permitido).
   */
  async read(task) {
    const content = await this.workspace.read(
      task.path,
    );

    return {
      path: task.path,
      content,
    };
  }

  /**
   * Escreve conteúdo em um arquivo. Valida que `content` é string
   * antes de delegar ao Workspace (que cria diretórios intermediários
   * se necessário).
   */
  async write(task) {
    if (typeof task.content !== "string") {
      throw new Error(
        "file.write exige content string",
      );
    }

    await this.workspace.write(
      task.path,
      task.content,
    );

    return {
      path: task.path,
      written: true,
    };
  }

  /**
   * Remove um arquivo ou diretório (recursivamente, se for
   * diretório). `force: false` significa que tentar deletar um
   * caminho inexistente lança erro, em vez de ser ignorado
   * silenciosamente.
   */
  async delete(task) {
    const target = this.workspace.resolve(
      task.path,
    );

    await fs.rm(target, {
      recursive: true,
      force: false,
    });

    return {
      path: task.path,
      deleted: true,
    };
  }

  /**
   * Lista o conteúdo de um diretório (não-recursivo), mapeando cada
   * entrada para um formato simplificado { name, type }.
   */
  async list(task) {
    const entries = await this.workspace.list(
      task.path || ".",
    );

    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory()
        ? "directory"
        : "file",
    }));
  }

  /**
   * Busca recursiva por arquivos cujo nome contenha `task.pattern`
   * (substring simples, não regex/glob). Se `task.pattern` não for
   * informado, retorna todos os arquivos da árvore.
   *
   * Nota: percorre diretórios recursivamente usando fs.readdir
   * diretamente (não via workspace.list), mas parte de um `root` já
   * validado por workspace.resolve(), então a busca continua restrita
   * ao workspace. Diretórios são visitados sequencialmente (um de
   * cada vez), o que é simples e seguro, mas pode ser lento em
   * árvores muito grandes.
   */
  async search(task) {
    const root = this.workspace.resolve(
      task.path || ".",
    );

    const results = [];

    async function walk(directory) {
      const entries = await fs.readdir(
        directory,
        {
          withFileTypes: true,
        },
      );

      for (const entry of entries) {
        const fullPath = `${directory}/${entry.name}`;

        if (entry.isDirectory()) {
          // Recursão: desce para subdiretórios antes de continuar
          // no nível atual.
          await walk(fullPath);
          continue;
        }

        // Inclui o arquivo se não houver filtro de pattern, ou se
        // o nome do arquivo contiver o pattern como substring.
        if (
          !task.pattern ||
          entry.name.includes(task.pattern)
        ) {
          results.push(
            fullPath,
          );
        }
      }
    }

    await walk(root);

    return results;
  }
}
