import { Permissions } from "./permissions.js";
import { CommandPolicy } from "./command-policy.js";

/**
 * role-permissions.js: define, para cada papel de sub-agente do
 * ecossistema (Investigador, Arquiteto, Programador, Validador,
 * Empacotador, Orquestrador), qual `Permissions` e `CommandPolicy`
 * ele deve receber.
 *
 * Princípio geral: cada papel só tem acesso ao MÍNIMO necessário
 * para sua função (least privilege). Isso limita o dano possível se
 * um sub-agente for enganado por um prompt malicioso, alucinar uma
 * ação perigosa, ou tiver algum bug — ele fisicamente não tem
 * permissão/ferramenta para ir além do seu papel, independente do
 * que "decidir" fazer.
 *
 * Cada função retorna um objeto { permissions, commandPolicy },
 * pronto para passar em `new Agent({ ...options, permissions,
 * commandPolicy })`.
 */

/**
 * Investigador (Explorer/Reader): só leitura, sem shell.
 * Mesmo git.commit e file.write/delete ficam bloqueados — ele
 * mapeia e lê, nunca altera nada.
 */
export function createExplorerPermissions() {
  return {
    permissions: new Permissions({
      role: "explorer",
      permissions: {
        "file.read": true,
        "file.write": false,
        "file.delete": false,
        "file.list": true,
        "file.search": true,

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
        "storage.write": false,
        "storage.delete": false,
        "storage.list": true,

        "artifact.build": false,
        "artifact.push": false,
        "artifact.list": true,
      },
    }),
    // Sem shell.execute liberado, o CommandPolicy nunca chega a ser
    // consultado de fato — mas ainda passamos uma instância "vazia"
    // (allowlist nenhuma) por defesa em profundidade, caso algum bug
    // futuro conceda shell.execute sem também revisar isto aqui.
    commandPolicy: new CommandPolicy({
      allowedCommands: [],
    }),
  };
}

/**
 * Arquiteto (Planner/Spec Writer): processamento puramente
 * analítico, sem NENHUMA ferramenta de sistema de arquivos, shell,
 * git ou rede. Na prática, o Agent do Arquiteto nem deveria receber
 * as capabilities de filesystem/shell/git/github/storage/artifacts
 * no momento de montá-lo — mas mesmo que receba (por reuso de
 * código), Permissions nega tudo por padrão aqui.
 */
export function createArchitectPermissions() {
  return {
    permissions: new Permissions({
      role: "architect",
      permissions: {
        "file.read": false,
        "file.write": false,
        "file.delete": false,
        "file.list": false,
        "file.search": false,

        "shell.execute": false,

        "git.status": false,
        "git.diff": false,
        "git.log": false,
        "git.branch": false,
        "git.commit": false,

        "github.issue_create": false,
        "github.issue_get": false,
        "github.pull_request_create": false,
        "github.pull_request_get": false,
        "github.repository_get": false,

        "storage.read": false,
        "storage.write": false,
        "storage.delete": false,
        "storage.list": false,

        "artifact.build": false,
        "artifact.push": false,
        "artifact.list": false,
      },
    }),
    commandPolicy: new CommandPolicy({
      allowedCommands: [],
    }),
  };
}

/**
 * Programador (Coder/Editor): pode ler e escrever arquivos, mas sem
 * shell, sem git.commit (isso é papel do Empacotador) e sem
 * github/storage/artifacts.
 */
export function createCoderPermissions() {
  return {
    permissions: new Permissions({
      role: "coder",
      permissions: {
        "file.read": true,
        "file.write": true,
        "file.delete": true,
        "file.list": true,
        "file.search": true,

        "shell.execute": false,

        "git.status": true,
        "git.diff": true,
        "git.log": true,
        "git.branch": true,
        "git.commit": false,

        "github.issue_create": false,
        "github.issue_get": false,
        "github.pull_request_create": false,
        "github.pull_request_get": false,
        "github.repository_get": false,

        "storage.read": false,
        "storage.write": false,
        "storage.delete": false,
        "storage.list": false,

        "artifact.build": false,
        "artifact.push": false,
        "artifact.list": false,
      },
    }),
    commandPolicy: new CommandPolicy({
      allowedCommands: [],
    }),
  };
}

/**
 * Validador (Tester/Executor): shell liberado, mas restrito por
 * PREFIXO EXATO a comandos de teste/build/lint conhecidos — não
 * apenas ao nome do executável. Isso impede, por exemplo, que o
 * Validador rode "npm publish" ou "npm install <algo>" só porque
 * "npm" está na allowlist de executáveis: cada prefixo precisa
 * bater exatamente.
 *
 * Ajuste esta lista conforme as linguagens/ferramentas reais do seu
 * ecossistema (adicionar "go test", "cargo test", "mvn test" etc.
 * conforme necessário).
 */
export function createValidatorPermissions() {
  const allowedPrefixes = [
    "npm test",
    "npm run test",
    "npm run lint",
    "npm run build",
    "npx jest",
    "npx vitest",
    "npx eslint",
    "pytest",
    "python -m pytest",
    "python3 -m pytest",
    "php -l",
    "composer validate",
  ];

  return {
    permissions: new Permissions({
      role: "validator",
      permissions: {
        // Precisa ler arquivos (ex: para inspecionar configuração
        // de teste), mas nunca escrever/deletar.
        "file.read": true,
        "file.write": false,
        "file.delete": false,
        "file.list": true,
        "file.search": true,

        "shell.execute": true,

        // Leitura de git liberada (ex: pra saber o que mudou antes
        // de rodar testes), commit bloqueado.
        "git.status": true,
        "git.diff": true,
        "git.log": true,
        "git.branch": true,
        "git.commit": false,

        "github.issue_create": false,
        "github.issue_get": false,
        "github.pull_request_create": false,
        "github.pull_request_get": false,
        "github.repository_get": false,

        "storage.read": false,
        "storage.write": false,
        "storage.delete": false,
        "storage.list": false,

        "artifact.build": false,
        "artifact.push": false,
        "artifact.list": false,
      },
    }),
    commandPolicy: new CommandPolicy({
      // Allowlist de executáveis ainda existe como primeira camada;
      // allowedPrefixes é a camada extra, mais restritiva.
      allowedCommands: [
        "npm",
        "npx",
        "pytest",
        "python",
        "python3",
        "php",
        "composer",
      ],
      allowedPrefixes,
    }),
  };
}

/**
 * Empacotador (Packager/Git Deployer): shell liberado, mas restrito
 * a comandos de empacotamento e deploy via git — não a comandos de
 * teste (isso é papel do Validador) nem edição de arquivos (isso é
 * papel do Programador).
 */
export function createPackagerPermissions() {
  const allowedPrefixes = [
    "git add",
    "git commit",
    "git push",
    "git status",
    "git log",
    "zip",
    "tar",
  ];

  return {
    permissions: new Permissions({
      role: "packager",
      permissions: {
        "file.read": true,
        "file.write": false,
        "file.delete": false,
        "file.list": true,
        "file.search": false,

        "shell.execute": true,

        "git.status": true,
        "git.diff": true,
        "git.log": true,
        "git.branch": true,
        // git.commit continua controlado pela GitCapability
        // dedicada (que já valida message/files), mas também
        // liberamos aqui porque o Empacotador é o papel responsável
        // por finalizar o commit.
        "git.commit": true,

        "github.issue_create": false,
        "github.issue_get": false,
        "github.pull_request_create": false,
        "github.pull_request_get": false,
        "github.repository_get": false,

        "storage.read": false,
        "storage.write": false,
        "storage.delete": false,
        "storage.list": false,

        "artifact.build": true,
        "artifact.push": true,
        "artifact.list": true,
      },
    }),
    commandPolicy: new CommandPolicy({
      allowedCommands: ["git", "zip", "tar"],
      allowedPrefixes,
    }),
  };
}

/**
 * Orquestrador (Supervisor/Planner): não deveria tocar em nenhuma
 * capability de sistema de arquivos/shell/git diretamente — sua
 * única "ferramenta" é despachar tasks para os outros sub-agentes
 * (ver ideia de AgentDispatchCapability discutida à parte). Aqui
 * negamos tudo, pelo mesmo motivo do Arquiteto: defesa em
 * profundidade, mesmo que o Agent do Orquestrador não receba essas
 * capabilities na prática.
 */
export function createOrchestratorPermissions() {
  return {
    permissions: new Permissions({
      role: "orchestrator",
      permissions: {
        "file.read": false,
        "file.write": false,
        "file.delete": false,
        "file.list": false,
        "file.search": false,

        "shell.execute": false,

        "git.status": false,
        "git.diff": false,
        "git.log": false,
        "git.branch": false,
        "git.commit": false,

        "github.issue_create": false,
        "github.issue_get": false,
        "github.pull_request_create": false,
        "github.pull_request_get": false,
        "github.repository_get": false,

        "storage.read": false,
        "storage.write": false,
        "storage.delete": false,
        "storage.list": false,

        "artifact.build": false,
        "artifact.push": false,
        "artifact.list": false,

        // Única ação real do Orquestrador: delegar para sub-agentes
        // via AgentDispatchCapability.
        "agent.dispatch": true,
      },
    }),
    commandPolicy: new CommandPolicy({
      allowedCommands: [],
    }),
  };
}
