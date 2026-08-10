import { Agent } from "../agent.js";
import { Workspace } from "../core/workspace.js";
import { AgentDispatchCapability } from "../agent-dispatch-capability.js";
import {
  createExplorerPermissions,
  createCoderPermissions,
  createValidatorPermissions,
  createPackagerPermissions,
  createOrchestratorPermissions,
} from "../security/role-permissions.js";
import { CoderValidatorLoop, MaxAttemptsExceededError } from "./coder-validator-loop.js";

/**
 * Monta o ecossistema completo de sub-agentes e devolve o
 * Orquestrador já pronto para receber pedidos do usuário via
 * `orchestratorAgent.execute({ type: "agent.dispatch", targetRole, payload })`.
 *
 * `callLlmForPlan`, `callLlmForCodeEdits`: funções fornecidas por
 * quem integra este módulo, responsáveis pelas chamadas de LLM reais
 * do Arquiteto e do Programador — ficam fora do escopo deste
 * arquivo, que só cuida da orquestração/permissões.
 */
export async function buildAgentEcosystem({
  callLlmForPlan,
  callLlmForCodeEdits,
}) {
  // Workspace compartilhado entre os sub-agentes que operam sobre
  // código (Investigador, Programador, Validador, Empacotador).
  const workspace = new Workspace({
    root: process.env.WORKSPACE_ROOT || "/workspace",
  });

  await workspace.initialize();

  const explorerPreset = createExplorerPermissions();
  const coderPreset = createCoderPermissions();
  const validatorPreset = createValidatorPermissions();
  const packagerPreset = createPackagerPermissions();
  const orchestratorPreset = createOrchestratorPermissions();

  const explorerAgent = new Agent({
    role: "explorer",
    workspace,
    permissions: explorerPreset.permissions,
    commandPolicy: explorerPreset.commandPolicy,
  });

  const coderAgent = new Agent({
    role: "coder",
    workspace,
    permissions: coderPreset.permissions,
    commandPolicy: coderPreset.commandPolicy,
  });

  const validatorAgent = new Agent({
    role: "validator",
    workspace,
    permissions: validatorPreset.permissions,
    commandPolicy: validatorPreset.commandPolicy,
  });

  const packagerAgent = new Agent({
    role: "packager",
    workspace,
    permissions: packagerPreset.permissions,
    commandPolicy: packagerPreset.commandPolicy,
  });

  await Promise.all([
    explorerAgent.start(),
    coderAgent.start(),
    validatorAgent.start(),
    packagerAgent.start(),
  ]);

  // Loop Programador/Validador, reaproveitando o que já foi
  // construído em coder-validator-loop.js. `onFailure` reverte
  // qualquer mudança do Programador via o Empacotador, caso o
  // limite de tentativas seja esgotado.
  const coderValidatorLoop = new CoderValidatorLoop({
    validatorAgent,
    testCommand: "npm test",
    maxAttempts: 3,
    timeoutMs: 120000,
    onFailure: async () => {
      await packagerAgent.execute({
        type: "shell.execute",
        command: "git checkout -- .",
      });
    },
  });

  // dispatchTargets: o "cardápio" de roles que o Orquestrador pode
  // chamar via agent.dispatch. Cada entrada é uma função async
  // (payload) => result — o formato do payload/result é livre por
  // role, definido aqui.
  const dispatchTargets = {
    /**
     * payload esperado: { path?: string, pattern?: string }
     * Ex: investigar a estrutura de um diretório específico, ou
     * buscar por um padrão de nome de arquivo em todo o workspace.
     */
    explorer: async (payload) => {
      const [listing, matches] = await Promise.all([
        explorerAgent.execute({
          type: "file.list",
          path: payload.path || ".",
        }),
        payload.pattern
          ? explorerAgent.execute({
              type: "file.search",
              path: payload.path || ".",
              pattern: payload.pattern,
            })
          : Promise.resolve(null),
      ]);

      return { listing, matches };
    },

    /**
     * payload esperado: { investigationReport: unknown, request: string }
     * O Arquiteto não usa Agent.execute() — é uma chamada de LLM
     * pura, sem nenhuma capability de sistema.
     */
    architect: async (payload) => {
      return callLlmForPlan({
        request: payload.request,
        investigationReport: payload.investigationReport,
      });
    },

    /**
     * payload esperado: { plan: unknown }
     * Roda o ciclo completo Programador -> Validador (com retries),
     * usando o loop já construído.
     */
    coder_validator: async (payload) => {
      try {
        const result = await coderValidatorLoop.run({
          plan: payload.plan,
          onCoderStep: async ({ plan, attempt, previousFeedback }) => {
            const edits = await callLlmForCodeEdits({
              plan,
              attempt,
              previousFeedback,
            });

            for (const edit of edits) {
              await coderAgent.execute({
                type: "file.write",
                path: edit.path,
                content: edit.content,
              });
            }

            return { editedFiles: edits.map((edit) => edit.path) };
          },
        });

        return { success: true, ...result };
      } catch (error) {
        if (error instanceof MaxAttemptsExceededError) {
          return {
            success: false,
            attempts: error.attempts,
            lastValidation: error.lastValidation,
          };
        }

        throw error;
      }
    },

    /**
     * payload esperado: { commitMessage: string, files?: string[], addAll?: boolean }
     * Empacota e envia: git add/commit/push. Não roda testes (isso
     * já rodou dentro de coder_validator) nem edita arquivos.
     */
    packager: async (payload) => {
      if (payload.files?.length) {
        await packagerAgent.execute({
          type: "shell.execute",
          command: `git add -- ${payload.files.join(" ")}`,
        });
      } else if (payload.addAll) {
        await packagerAgent.execute({
          type: "shell.execute",
          command: "git add -A",
        });
      }

      const commitResult = await packagerAgent.execute({
        type: "git.commit",
        message: payload.commitMessage,
      });

      const pushResult = await packagerAgent.execute({
        type: "shell.execute",
        command: "git push",
      });

      return { commitResult, pushResult };
    },
  };

  const orchestratorAgent = new Agent({
    role: "orchestrator",
    workspace,
    permissions: orchestratorPreset.permissions,
    commandPolicy: orchestratorPreset.commandPolicy,
    extraCapabilities: {
      dispatch: new AgentDispatchCapability({
        permissions: orchestratorPreset.permissions,
        dispatchTargets,
      }),
    },
  });

  await orchestratorAgent.start();

  return {
    orchestratorAgent,
    // Expostos também individualmente, útil para logging/testes ou
    // para desligar tudo de forma coordenada (ver stopAll abaixo).
    subAgents: { explorerAgent, coderAgent, validatorAgent, packagerAgent },

    async stopAll() {
      await Promise.all([
        orchestratorAgent.stop(),
        explorerAgent.stop(),
        coderAgent.stop(),
        validatorAgent.stop(),
        packagerAgent.stop(),
      ]);
    },
  };
}

/**
 * Exemplo de uso ponta a ponta.
 */
async function example() {
  const { orchestratorAgent, stopAll } = await buildAgentEcosystem({
    callLlmForPlan: async ({ request, investigationReport }) => {
      // chamada real ao LLM do Arquiteto aqui
      return { steps: ["editar src/index.js"] };
    },
    callLlmForCodeEdits: async ({ plan, attempt, previousFeedback }) => {
      // chamada real ao LLM do Programador aqui
      return [{ path: "src/index.js", content: "// código gerado" }];
    },
  });

  try {
    // 1. Investigar
    const investigation = await orchestratorAgent.execute({
      type: "agent.dispatch",
      targetRole: "explorer",
      payload: { path: "src", pattern: "index" },
    });

    // 2. Planejar
    const planning = await orchestratorAgent.execute({
      type: "agent.dispatch",
      targetRole: "architect",
      payload: {
        request: "adicionar validação de input",
        investigationReport: investigation.result,
      },
    });

    // 3. Codificar + validar (com retry automático)
    const coding = await orchestratorAgent.execute({
      type: "agent.dispatch",
      targetRole: "coder_validator",
      payload: { plan: planning.result },
    });

    // 4. Empacotar (só se a validação passou)
    if (coding.result.success) {
      await orchestratorAgent.execute({
        type: "agent.dispatch",
        targetRole: "packager",
        payload: {
          commitMessage: "feat: adiciona validação de input",
          addAll: true,
        },
      });
    }
  } finally {
    await stopAll();
  }
}
