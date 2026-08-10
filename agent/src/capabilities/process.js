import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { parseCommand } from "../utils/parse-command.js";
import { truncateOutput } from "../utils/run-command.js";

const DEFAULT_PROCESS_TIMEOUT_MS = 600000; // 10 min — kill automático do execa
const MAX_OUTPUT_CHARS = 200000;

/**
 * ProcessCapability: inicia processos controlados (ex: um servidor
 * de dev para testes de integração), com timeout automático,
 * captura de stdout/stderr (com limite de tamanho), consulta de
 * status e encerramento explícito.
 *
 * Diferente de TestCapability/BuildCapability/PackageCapability (que
 * rodam até o fim e retornam o resultado completo de uma vez), esta
 * é para processos que ficam rodando em background — por isso
 * mantém um registro em memória por instância (cada Agent tem a sua
 * própria, então processos de um Agent nunca vazam para outro).
 */
export class ProcessCapability {
  constructor({ workspace, permissions, commandPolicy }) {
    if (!commandPolicy) {
      throw new Error(
        "ProcessCapability exige commandPolicy (allowlist dedicada de comandos de processo)",
      );
    }

    this.workspace = workspace;
    this.permissions = permissions;
    this.commandPolicy = commandPolicy;
    // processId -> { child, command, startedAt, stdout, stderr, status, exitCode }
    this.processes = new Map();
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "process.start":
        return this.start(task);
      case "process.status":
        return this.status(task);
      case "process.output":
        return this.output(task);
      case "process.kill":
        return this.kill(task);
      default:
        throw new Error(`Operação process desconhecida: ${task.type}`);
    }
  }

  async start(task) {
    if (!task.command || typeof task.command !== "string") {
      throw new Error("process.start exige 'command' (string)");
    }

    this.commandPolicy.validate(task.command);

    const [executable, ...args] = parseCommand(task.command);
    const timeoutMs = task.timeoutMs || DEFAULT_PROCESS_TIMEOUT_MS;
    const processId = randomUUID();

    const child = execa(executable, args, {
      cwd: this.workspace.root,
      reject: false,
      timeout: timeoutMs,
    });

    const record = {
      child,
      command: task.command,
      startedAt: Date.now(),
      stdout: "",
      stderr: "",
      status: "running",
      exitCode: null,
    };

    child.stdout?.on("data", (chunk) => {
      record.stdout = truncateOutput(
        record.stdout + chunk.toString(),
        MAX_OUTPUT_CHARS,
      );
    });

    child.stderr?.on("data", (chunk) => {
      record.stderr = truncateOutput(
        record.stderr + chunk.toString(),
        MAX_OUTPUT_CHARS,
      );
    });

    child
      .then((result) => {
        // record.status pode já ter sido setado como "killed" por
        // kill() antes do processo de fato terminar — não sobrescreve
        // nesse caso.
        if (record.status === "running") {
          record.status = result.timedOut ? "timeout" : "exited";
        }
        record.exitCode = result.exitCode ?? null;
      })
      .catch((error) => {
        if (record.status === "running") {
          record.status = "error";
        }
        record.error = error.message;
      });

    this.processes.set(processId, record);

    return { processId, command: task.command, status: record.status };
  }

  getRecord(task) {
    if (!task.processId || typeof task.processId !== "string") {
      throw new Error("processId (string) é obrigatório");
    }

    const record = this.processes.get(task.processId);

    if (!record) {
      const error = new Error(`Processo não encontrado: ${task.processId}`);
      error.code = "PROCESS_NOT_FOUND";
      throw error;
    }

    return record;
  }

  async status(task) {
    const record = this.getRecord(task);

    return {
      processId: task.processId,
      command: record.command,
      status: record.status,
      exitCode: record.exitCode,
      runningForMs: Date.now() - record.startedAt,
    };
  }

  async output(task) {
    const record = this.getRecord(task);

    return {
      processId: task.processId,
      status: record.status,
      stdout: record.stdout,
      stderr: record.stderr,
    };
  }

  async kill(task) {
    const record = this.getRecord(task);

    if (record.status === "running") {
      record.child.kill(task.signal || "SIGTERM");
      record.status = "killed";
    }

    return { processId: task.processId, status: record.status };
  }
}
