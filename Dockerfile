# ── Stage: build-info ─────────────────────────────────────────────────────
# Captura SHA curto + data do commit a partir do .git do contexto de build.
# Fica num stage descartado — nunca entra na imagem final (só os 2 arquivos
# de texto, via COPY --from). Qualquer falha aqui (git ausente, .git ausente,
# apt-get offline) degrada para "unknown" e NUNCA derruba o build da imagem
# final — ver src/services/buildInfo.js para o fallback de leitura.
FROM node:18-slim AS build-info
RUN apt-get update && apt-get install -y --no-install-recommends git || true
WORKDIR /src
COPY . .
RUN git rev-parse --short HEAD > /GIT_SHA 2>/dev/null || echo "unknown" > /GIT_SHA
RUN git log -1 --format=%cI > /GIT_DATE 2>/dev/null || echo "unknown" > /GIT_DATE

# ── Stage final ────────────────────────────────────────────────────────────
# node:18-slim — nenhuma dependência do projeto compila addon nativo (checado:
# zero binding.gyp na árvore de node_modules); a única vez que isso deixou de
# ser verdade (sharp, puxado transitivamente por @xenova/transformers) o
# pacote já foi removido do projeto. Volta pra slim reduz imagem/superfície
# sem perder nada hoje — se uma dependência futura precisar compilar algo
# nativo, isso aparece como falha clara no `npm install` abaixo, não como
# silêncio.
FROM node:18-slim
WORKDIR /usr/src/app
# python3-minimal — único uso: src/solaris/workers/pythonWorker.js faz
# shell-out pra `python3 -c "ast.parse(...)"` (Worker de validação
# Flask/Django, tipo "py"). NUNCA exec()/eval() — ast.parse só constrói a
# árvore sintática do código do usuário, nenhuma linha roda de verdade,
# nenhum import é resolvido. Decisão consciente de exceção ao "zero
# dependência de sistema" do resto da imagem (ver comentário abaixo):
# não existe parser Python puro-JS maduro o bastante pra sintaxe Python 3
# moderna (avaliados: filbert/python-ast) — sem alternativa determinística
# puro-JS viável, entra o runtime mínimo só pra validar sintaxe (ver
# src/solaris/workers/pythonWorker.js e src/solaris/pipeline/orchestrator.js
# pro racional completo).
RUN apt-get update && apt-get install -y --no-install-recommends python3-minimal && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps
COPY . .
COPY --from=build-info /GIT_SHA /usr/src/app/GIT_SHA
COPY --from=build-info /GIT_DATE /usr/src/app/GIT_DATE
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /usr/src/app/BUILD_TIME
# Smoke test determinístico: carrega, sob o Node exato desta imagem, toda a
# árvore de require() que server.js carrega ANTES de app.listen(). Existe
# porque um require() de pacote ESM-only (parse5@8, "ERR_REQUIRE_ESM") ou um
# SyntaxError num template literal (crase não escapada em chat.js, incidente
# anterior) só quebram nessa versão exata do Node — o dev local roda Node
# mais novo (com require(esm) e sem o bug), então nenhum teste local pega
# isso. Falha AQUI, no build, sem `|| true` — é o mesmo princípio de
# verificação mecânica pós-compilação já usado no resto do compilador
# (dossieIntegrityChecker etc.): nunca confiar que "rodou aqui" significa
# "roda em produção".
RUN node -e "require('./src/services/envBoot');require('./src/services/firebase');require('./src/middlewares/security');require('./src/routes/authRoutes');require('./src/routes/dashboardRoutes');require('./src/routes/contatoRoutes');require('./src/routes/apiRoutes');require('./src/routes/adminRoutes');require('./src/routes/workersRoutes');require('./src/services/sentinelWorker');require('./src/services/errorLogWorker');require('./src/services/buildInfo');console.log('[BUILD] Grafo de módulos de server.js carrega sem erro sob Node ' + process.version);"
EXPOSE 8080
CMD ["node", "server.js"]
