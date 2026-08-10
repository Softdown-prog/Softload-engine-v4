import { ProtocolError } from "./protocol.js";

// Prefixo de `task.type` usado internamente pelo TaskRouter, por
// capability. Na maioria dos casos é igual ao nome da capability —
// a exceção é "artifacts", cujo prefixo interno é o singular
// "artifact" (ver nota em task-router.js). Centralizar isso aqui
// evita que essa particularidade fique espalhada/duplicada em
// vários lugares do código.
const TASK_TYPE_PREFIX = {
  filesystem: "file",
  shell: "shell",
  git: "git",
  github: "github",
  storage: "storage",
  artifacts: "artifact",
};

// Alguns campos do protocolo usam snake_case (convenção comum em
// APIs JSON), enquanto o código interno usa camelCase (convenção do
// JS). Este mapa traduz nome-do-campo-no-protocolo ->
// nome-do-campo-interno, por capability. Só precisa listar os
// campos que realmente mudam de nome — os demais são copiados como
// estão.
const FIELD_RENAMES = {
  shell: {
    timeout_ms: "timeoutMs",
  },
  git: {
    add_all: "addAll",
  },
};

/**
 * Converte uma action já validada pelo protocolo (parseTaskRequest)
 * no formato de task esperado por Agent.execute() / TaskRouter.
 *
 * Ex:
 *   { id: "a1", capability: "filesystem", operation: "read",
 *     input: { path: "src/index.js" } }
 *   ->
 *   { type: "file.read", path: "src/index.js" }
 *
 *   { id: "a2", capability: "shell", operation: "execute",
 *     input: { command: "npm test", timeout_ms: 30000 } }
 *   ->
 *   { type: "shell.execute", command: "npm test", timeoutMs: 30000 }
 */
export function actionToTask(action) {
  const prefix = TASK_TYPE_PREFIX[action.capability];

  if (!prefix) {
    // Só aconteceria se uma nova capability fosse adicionada ao
    // protocolo (actionSchema/CAPABILITY_OPERATIONS) sem atualizar
    // este mapa — erro de configuração, não de input do usuário.
    throw new ProtocolError(
      `Nenhum prefixo de task.type configurado para capability: ${action.capability}`,
      "TASK_TYPE_PREFIX_NOT_FOUND",
    );
  }

  const type = `${prefix}.${action.operation}`;

  const renames = FIELD_RENAMES[action.capability] || {};

  const renamedInput = {};

  for (const [key, value] of Object.entries(action.input)) {
    const renamedKey = renames[key] || key;
    renamedInput[renamedKey] = value;
  }

  return {
    type,
    ...renamedInput,
  };
}

/**
 * Converte uma request inteira (já validada por parseTaskRequest)
 * em uma lista de tasks prontas para Agent.execute(), preservando a
 * referência ao `id` original de cada action — necessário para
 * o chamador (ex: endpoint HTTP) casar cada resultado de volta com
 * a action que o gerou, já que Agent.execute() não sabe nada sobre
 * "id" de protocolo.
 */
export function requestToTasks(request) {
  return request.actions.map((action) => ({
    actionId: action.id,
    task: actionToTask(action),
  }));
}
