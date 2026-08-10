import { z } from "zod";

// ── Schemas de input por capability ─────────────────────────────
// Cada schema define os campos aceitos para AQUELA capability como
// um todo (não por operação específica). `.strict()` rejeita
// qualquer campo extra não listado, evitando que dados inesperados
// passem adiante silenciosamente.

const filesystemInput = z.object({
  path: z.string().min(1),
  content: z.string().optional(),
  pattern: z.string().optional(),
}).strict();

const shellInput = z.object({
  command: z.string().min(1),
  // Limite máximo de 10 minutos (600000ms) para o timeout que o
  // chamador pode pedir — evita que uma action tente travar um
  // processo indefinidamente.
  timeout_ms: z.number().int().positive().max(600000).optional(),
}).strict();

const gitInput = z.object({
  // Nota: `message` é opcional aqui, mas a operação "commit"
  // realmente precisa dele (GitCapability.commit() já valida isso
  // internamente). Como o schema é por capability, não por
  // operação, esse tipo de exigência específica não é pega neste
  // nível — só mais adiante, dentro da capability real.
  message: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  // Espelham as opções adicionadas em GitCapability.commit():
  // arquivos específicos para `git add`, ou tudo (`git add -A`).
  files: z.array(z.string().min(1)).optional(),
  add_all: z.boolean().optional(),
}).strict();

const githubInput = z.object({
  owner: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  issue_number: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
}).strict();

const storageInput = z.object({
  bucket: z.string().min(1),
  path: z.string().min(1),
  content: z.string().optional(),
}).strict();

const artifactsInput = z.object({
  name: z.string().min(1),
  path: z.string().min(1).optional(),
}).strict();

// ── Schema de uma action individual ─────────────────────────────

const actionSchema = z.object({
  id: z.string().min(1).max(100),

  capability: z.enum([
    "filesystem",
    "shell",
    "git",
    "github",
    "storage",
    "artifacts",
  ]),

  operation: z.string().min(1).max(100),

  // Validação "grosseira" nesta etapa: apenas garante que é um
  // objeto simples de chaves string -> valor desconhecido. A
  // validação real e específica acontece depois, em
  // validateOperation(), usando o schema correspondente à
  // capability.
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();

// ── Schema da request completa ──────────────────────────────────

const requestSchema = z.object({
  request_id: z.string().min(1).max(200),

  // `z.literal("execute")`: por enquanto só existe um tipo de task
  // suportado no protocolo; usar literal (em vez de enum) já deixa
  // claro que é fixo, e facilita adicionar outros valores no futuro
  // sem quebrar a validação existente.
  task: z.literal("execute"),

  actions: z
    .array(actionSchema)
    .min(1)
    .max(50), // limite superior evita requests com centenas/milhares de actions
}).strict();

// ── Operações válidas por capability ─────────────────────────────
// Funciona como a allowlist de "operation" aceitas para cada
// capability — evita que alguém passe uma capability válida com uma
// operação inventada/typo.

const CAPABILITY_OPERATIONS = {
  filesystem: new Set([
    "read",
    "write",
    "delete",
    "list",
    "search",
  ]),

  shell: new Set([
    "execute",
  ]),

  git: new Set([
    "status",
    "diff",
    "log",
    "branch",
    "commit",
  ]),

  github: new Set([
    "issue_create",
    "issue_get",
    "pull_request_create",
    "pull_request_get",
    "repository_get",
  ]),

  storage: new Set([
    "read",
    "write",
    "delete",
    "list",
  ]),

  artifacts: new Set([
    "build",
    "push",
    "list",
  ]),
};

// Mapa de capability -> schema de input correspondente, usado em
// validateOperation() para saber qual schema aplicar.
const INPUT_SCHEMAS = {
  filesystem: filesystemInput,
  shell: shellInput,
  git: gitInput,
  github: githubInput,
  storage: storageInput,
  artifacts: artifactsInput,
};

/**
 * Valida uma action já validada estruturalmente pelo actionSchema
 * (capability é um enum válido, operation é string, etc.), mas
 * ainda checando:
 * 1. Se a capability é reconhecida (redundante com o enum do Zod,
 *    mas serve de proteção extra caso o enum mude no futuro).
 * 2. Se a operation é válida PARA aquela capability específica.
 * 3. Se o input bate com o schema específico da capability.
 *
 * Retorna a action com `input` já normalizado/validado pelo Zod
 * (ex: aplicando defaults, coerções, etc. definidos no schema).
 */
function validateOperation(action) {
  const operations =
    CAPABILITY_OPERATIONS[action.capability];

  if (!operations) {
    throw new ProtocolError(
      `Capability não suportada: ${action.capability}`,
      "CAPABILITY_NOT_SUPPORTED",
    );
  }

  if (!operations.has(action.operation)) {
    throw new ProtocolError(
      `Operação não suportada: ${action.capability}.${action.operation}`,
      "OPERATION_NOT_SUPPORTED",
    );
  }

  const schema =
    INPUT_SCHEMAS[action.capability];

  if (!schema) {
    // Não deveria acontecer na prática (toda capability em
    // CAPABILITY_OPERATIONS tem um schema correspondente em
    // INPUT_SCHEMAS), mas protege contra as duas listas ficarem
    // dessincronizadas no futuro (ex: alguém adiciona uma
    // capability em um mapa e esquece do outro).
    throw new ProtocolError(
      `Schema inexistente para capability: ${action.capability}`,
      "INPUT_SCHEMA_NOT_FOUND",
    );
  }

  // safeParse (em vez de parse) permite tratar o erro de forma
  // customizada, incluindo os `issues` detalhados do Zod no
  // ProtocolError, em vez de deixar a exceção nativa do Zod vazar.
  const result = schema.safeParse(action.input);

  if (!result.success) {
    throw new ProtocolError(
      `Input inválido para ${action.capability}.${action.operation}`,
      "INVALID_ACTION_INPUT",
      result.error.issues,
    );
  }

  return {
    ...action,
    input: result.data,
  };
}

/**
 * Ponto de entrada principal: valida um payload bruto (ex: vindo de
 * uma requisição HTTP) contra o protocolo completo.
 *
 * Fail-fast: `actions.map(validateOperation)` interrompe no
 * primeiro erro encontrado — se qualquer action for inválida, a
 * request inteira é rejeitada (nenhuma action é executada
 * parcialmente).
 *
 * Lança ProtocolError em caso de payload inválido; quem chama deve
 * tratar esse erro (ex: responder 400 numa API HTTP).
 */
export function parseTaskRequest(payload) {
  const requestResult =
    requestSchema.safeParse(payload);

  if (!requestResult.success) {
    throw new ProtocolError(
      "Payload do Worker inválido",
      "INVALID_REQUEST",
      requestResult.error.issues,
    );
  }

  const request = requestResult.data;

  const actions = request.actions.map(
    validateOperation,
  );

  return {
    request_id: request.request_id,
    task: request.task,
    actions,
  };
}

/**
 * Versão booleana de parseTaskRequest, útil para checagens rápidas
 * sem precisar de try/catch no código chamador. Descarta os
 * detalhes do erro — usar parseTaskRequest diretamente quando os
 * detalhes importarem (ex: para responder com uma mensagem de erro
 * útil).
 */
export function isValidTaskRequest(payload) {
  try {
    parseTaskRequest(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna um objeto simples { capability: [operations] }, útil para
 * expor via endpoint de introspecção/documentação (ex: um
 * "/capabilities" que lista o que o Worker suporta), já que Sets
 * não serializam bem em JSON diretamente.
 */
export function getSupportedOperations() {
  return Object.fromEntries(
    Object.entries(CAPABILITY_OPERATIONS).map(
      ([capability, operations]) => [
        capability,
        [...operations],
      ],
    ),
  );
}

/**
 * Erro customizado do protocolo, com `code` (string estável, útil
 * para o cliente tratar programaticamente sem parsear a mensagem)
 * e `details` opcional (ex: os `issues` do Zod, com o path exato do
 * campo que falhou).
 *
 * Nota: esta classe é usada por parseTaskRequest/validateOperation,
 * definidos ACIMA dela no arquivo. Isso funciona sem erro porque
 * são function declarations (hoisted) que só referenciam
 * ProtocolError quando de fato chamadas — e, a essa altura, o
 * módulo inteiro (incluindo esta classe) já terminou de ser
 * avaliado. Ainda assim, por clareza de leitura, pode valer mover
 * esta classe para o topo do arquivo ou para um arquivo separado de
 * erros (como o AgentError usado nos outros módulos).
 */
export class ProtocolError extends Error {
  constructor(
    message,
    code = "PROTOCOL_ERROR",
    details = undefined,
  ) {
    super(message);

    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
  }
}
