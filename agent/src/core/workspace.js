import fs from "node:fs/promises";
import path from "node:path";

/**
 * Workspace: abstrai um diretório raiz isolado onde o agent pode ler,
 * escrever e listar arquivos. Toda operação passa por `resolve()`,
 * que impede que caminhos relativos "escapem" do diretório raiz
 * (proteção contra path traversal, ex: "../../etc/passwd").
 */
export class Workspace {
  constructor({ root }) {
    // Normaliza e resolve o root para um caminho absoluto, garantindo
    // uma base consistente para todas as comparações feitas depois.
    this.root = path.resolve(root);
  }

  /**
   * Cria o diretório raiz do workspace caso ainda não exista
   * (incluindo diretórios intermediários, graças a `recursive: true`).
   */
  async initialize() {
    await fs.mkdir(this.root, {
      recursive: true,
    });
  }

  /**
   * Resolve um caminho relativo para um caminho absoluto DENTRO do
   * workspace, lançando erro se o resultado ficar fora dele.
   *
   * Estratégia:
   * 1. Resolve `relativePath` em relação a `this.root`.
   * 2. Calcula o caminho relativo entre `root` e o `target` resolvido.
   * 3. Se esse caminho relativo começar com ".." (subiu um nível
   *    acima do root) ou for absoluto (caso de path.relative não
   *    encontrar prefixo comum, ex: em outro drive no Windows),
   *    o acesso é bloqueado.
   *
   * Isso também cobre o caso de `relativePath` já vir como um
   * caminho absoluto (ex: "/etc/passwd"): o path.resolve ignora o
   * root nesse caso, mas o path.relative resultante vai começar
   * com ".." e cair no bloqueio mesmo assim.
   *
   * Observação: esta validação é apenas textual/sintática — não
   * resolve symlinks. Um symlink dentro do workspace apontando para
   * fora dele não seria pego por esta checagem.
   */
  resolve(relativePath = ".") {
    const target = path.resolve(
      this.root,
      relativePath,
    );

    const relative = path.relative(
      this.root,
      target,
    );

    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Caminho fora do workspace: ${relativePath}`,
      );
    }

    return target;
  }

  /**
   * Verifica se um caminho existe dentro do workspace.
   * Retorna false tanto se o arquivo não existir quanto se o
   * caminho for inválido/fora do workspace (resolve() lançaria erro,
   * capturado pelo catch).
   */
  async exists(relativePath) {
    try {
      await fs.access(
        this.resolve(relativePath),
      );

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lê o conteúdo de um arquivo dentro do workspace.
   * `encoding` default "utf8" retorna string; passar `null`
   * retornaria um Buffer, se necessário no futuro.
   */
  async read(relativePath, encoding = "utf8") {
    return fs.readFile(
      this.resolve(relativePath),
      encoding,
    );
  }

  /**
   * Escreve conteúdo em um arquivo dentro do workspace, criando
   * automaticamente os diretórios intermediários necessários.
   * Sempre grava como utf8.
   */
  async write(relativePath, content) {
    const target = this.resolve(relativePath);

    await fs.mkdir(
      path.dirname(target),
      {
        recursive: true,
      },
    );

    await fs.writeFile(
      target,
      content,
      "utf8",
    );

    return {
      path: target,
    };
  }

  /**
   * Lista o conteúdo de um diretório dentro do workspace.
   * `withFileTypes: true` retorna objetos Dirent (permite checar
   * facilmente se cada entrada é arquivo, diretório, symlink, etc.
   * via `.isFile()` / `.isDirectory()`).
   */
  async list(relativePath = ".") {
    return fs.readdir(
      this.resolve(relativePath),
      {
        withFileTypes: true,
      },
    );
  }
}
