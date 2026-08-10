# softload-worker-agent

## Estrutura do projeto

```
agent/
├── package.json
├── Dockerfile
└── src/
    ├── index.js                     # entrypoint (node src/index.js)
    ├── agent.js                     # classe Agent: monta workspace, permissions, capabilities
    ├── agent-dispatch-capability.js # capability usada pelo Orquestrador para delegar a sub-agentes
    │
    ├── core/
    │   ├── task-router.js           # resolve task.type -> capability
    │   ├── task-runner.js           # executa a task já roteada, padroniza resultado
    │   └── workspace.js             # diretório de trabalho isolado (protegido contra path traversal)
    │
    ├── capabilities/
    │   ├── filesystem.js            # file.read/write/delete/list/search
    │   ├── shell.js                 # shell.execute (via execa, sem shell:true)
    │   ├── git.js                   # git.status/diff/log/branch/commit
    │   ├── github.js                # stub — github.issue_*/pull_request_*/repository_get
    │   ├── storage.js               # stub — storage.read/write/delete/list
    │   └── artifacts.js             # stub — artifact.build/push/list
    │
    ├── security/
    │   ├── permissions.js           # allowlist/denylist por task.type, com mode "restricted"/"full"
    │   ├── command-policy.js        # allowlist de executáveis + prefixos exatos para shell.execute
    │   └── role-permissions.js      # presets prontos por papel de sub-agente (ver abaixo)
    │
    ├── orchestration/
    │   ├── coder-validator-loop.js  # loop Programador<->Validador com limite de tentativas
    │   ├── orchestrator-example.js  # wiring completo: Orquestrador + todos os sub-agentes
    │   └── example-usage.js         # exemplo isolado do loop Programador/Validador
    │
    ├── protocol/
    │   ├── protocol.js              # validação (Zod) do payload de entrada da API do Worker
    │   └── protocol-adapter.js      # traduz {capability, operation} -> task.type interno
    │
    └── utils/
        ├── logger.js                # logger JSON estruturado (campo "severity", compatível com Cloud Logging)
        ├── errors.js                # AgentError
        └── parse-command.js         # parser de comando shell com suporte a aspas
```

## Sub-agentes (ver `security/role-permissions.js`)

| Papel         | Preset                         | Pode                                             |
|---------------|---------------------------------|---------------------------------------------------|
| Investigador  | `createExplorerPermissions`     | ler/listar/buscar arquivos, git read-only          |
| Arquiteto     | `createArchitectPermissions`    | nada (puramente chamada de LLM, sem capabilities)  |
| Programador   | `createCoderPermissions`        | ler/escrever/deletar arquivos, git read-only        |
| Validador     | `createValidatorPermissions`    | shell restrito a comandos de teste/lint/build       |
| Empacotador   | `createPackagerPermissions`     | shell restrito a git add/commit/push, zip, tar      |
| Orquestrador  | `createOrchestratorPermissions` | só `agent.dispatch` (delega para os outros papéis)  |

## O que foi ajustado ao organizar

- `capabilities/shell-capability.js` e `capabilities/git-capability.js` renomeados para `shell.js`/`git.js`
  (nomes que `agent.js` já esperava).
- `github-capability.js`/`storage-capability.js`/`artifacts-capability.js` movidos para `capabilities/`
  e renomeados para `github.js`/`storage.js`/`artifacts.js`.
- Corrigido `import "./utils/parse-command.js"` → `"../utils/parse-command.js"` em `shell.js` e
  `command-policy.js` (ambos ficam uma pasta abaixo de `src/`, então precisam subir um nível).
- Criado `utils/errors.js` (classe `AgentError`) — era importado por `task-router.js`/`task-runner.js`
  mas nunca existia no projeto.
- Removida duplicata de `task-router.js` (havia uma cópia idêntica solta na raiz).
- Removida versão desatualizada de `protocol.js` (havia uma cópia em `src/core/task-protocol.js`
  sem os campos `files`/`add_all` do `gitInput`).
- Descartados arquivos `.txt` vazios (`2.txt`, `x1.txt`, `x1 - Copia.txt`, `x1 - Copia (2).txt`) —
  pareciam sobra de cópia manual de arquivos, sem conteúdo.

## Validado antes de empacotar

- Todos os `import` relativos resolvem para arquivos existentes.
- `node --check` passou em todos os arquivos `.js` (sem erro de sintaxe).

Não instalei `node_modules` nem rodei o app de fato (sem acesso à internet neste ambiente) — vale rodar
`npm install && npm start` localmente antes de subir pro Cloud Run.
