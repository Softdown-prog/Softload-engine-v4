import { Agent } from "./agent.js";
import { createLogger } from "./utils/logger.js";

// Logger nomeado especificamente para este módulo, facilita filtrar
// logs vindos do worker agent em meio a outros serviços/módulos.
const logger = createLogger("worker-agent");

/**
 * Ponto de entrada principal do processo.
 * Instancia o Agent, inicia seu trabalho e mantém o processo vivo
 * enquanto ele estiver ativo.
 */
async function main() {
  const agent = new Agent();

  logger.info("Solaris Worker Agent iniciando");

  // Inicializa o agent (ex: conexões, filas, listeners, etc.).
  // Assume-se que `start()` resolve assim que o agent está pronto
  // para operar, não quando termina de trabalhar.
  await agent.start();

  logger.info("Solaris Worker Agent pronto");

  // O processo permanece vivo enquanto o Agent estiver trabalhando.
  // `wait()` deve retornar uma Promise que só resolve quando o agent
  // termina seu ciclo de vida (ex: parado manualmente, erro fatal
  // interno, etc.). Enquanto essa Promise estiver pendente, o event
  // loop do Node continua rodando e o processo não encerra.
  await agent.wait();
}

// Executa main() e trata qualquer erro não capturado dentro dela
// (incluindo rejeições de Promise, já que main() é async).
main().catch((error) => {
  logger.error("Falha fatal no Worker Agent", {
    error: error.message,
    stack: error.stack,
  });

  // Encerra o processo com código de erro (1), sinalizando falha.
  // Importante no Cloud Run: um exit code != 0 pode disparar
  // reinício/reagendamento do container dependendo da configuração.
  process.exit(1);
});

// Observação (não é um bug, apenas sugestão):
// Não há handler para SIGTERM/SIGINT aqui. O Cloud Run envia SIGTERM
// antes de encerrar ou reciclar uma instância; sem um handler, o
// processo é derrubado imediatamente, podendo interromper o agent
// no meio de um trabalho. Um shutdown gracioso ficaria assim:
//
// process.on("SIGTERM", async () => {
//   logger.info("SIGTERM recebido, encerrando Worker Agent...");
//   await agent.stop?.(); // se o Agent expuser um método de parada
//   process.exit(0);
// });
