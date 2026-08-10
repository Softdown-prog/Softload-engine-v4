'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const multer  = require('multer');
const rateLimit = require('express-rate-limit');

const { exigirLogin, verificarSaldo } = require('../../middlewares/authGuard');
const chatStorage       = require('../../services/chatStorageService');
const { db, admin }     = require('../../services/firebase');
const { debitarCreditos, PLAN_CREDITS } = require('../../services/creditService');
const { criarSolarisChat } = require('../../solaris/chat/solarisChat');
const { detectarMarcador, removerMarcadorTruncado } = require('../../solaris/chat/solarisGenerationTrigger');
const { criarOrquestrador } = require('../../solaris/pipeline/orchestrator');
const { criarModelRouter }  = require('../../solaris/llm/modelRouter');
const { inspecionarProjeto } = require('../../solaris/pipeline/projectInspector');
const { responderOuEditarProjeto } = require('../../solaris/pipeline/projectEditor');
const { extrairZip, criarZip, criarArquivo, deletarArquivo, listarProjeto, lerArquivo } = require('../../solaris/tools/fileTools');
const { detectarFramework } = require('../../solaris/tools/frameworkDetector');
const { salvarProjeto, carregarProjeto, apagarProjeto } = require('../../solaris/tools/projectStorage');

// ──────────────────────────────────────────────────────────────────────────
// CHAT DO SOLARIS CODE — rota + view próprias, motor totalmente separado
// do Blogger Engine (ver src/solaris/README.md). Mesma separação
// estrutural que o Sol (/eu/sol, admin) e o Especialista Blogger
// (/dashboard/chat) já têm — sem misturar histórico/contexto entre eles.
//
// Créditos: Solaris é Gemini-only (mesmo pool "creditos"/"creditos_expira_em"
// do Especialista Blogger) — verificarSaldo já resolve o pool certo sozinho
// (só olha req.body.model === 'gpt-5.4', que o Solaris nunca envia). Cobra
// pelos tokens reais do usageMetadata do Gemini (mesma fonte de
// src/services/geminiService.js), nunca por chamada fixa.
//
// Fase 3: confirmação do manifesto → geração de verdade. O marcador
// [[SOLARIS_GERAR:{...}]] (ver solarisGenerationTrigger.js) dispara
// orchestrator.gerarProjeto() num diretório temporário — o ZIP resultante
// volta em base64 no evento "done" (projetos do Solaris são pequenos o
// bastante pra isso, sem precisar de upload/rota de download própria) e
// nunca é persistido em disco além do request (fs.rmSync no finally do
// diretório temp). Sem link de download no histórico — a sessão salva só
// o texto da conversa, mesmo escopo documentado em src/solaris/README.md.
// ──────────────────────────────────────────────────────────────────────────
const SOLARIS_CHAT_SESSION_TYPE = 'solaris-chat';

const solarisChat = criarSolarisChat();
const modelRouter  = criarModelRouter();
const orquestrador = criarOrquestrador({ modelRouter });

router.get('/dashboard/solaris', exigirLogin, async (req, res) => {
    const planoSessao = req.session.user?.plano || 'free';
    let creditosGemini      = PLAN_CREDITS[planoSessao] ?? PLAN_CREDITS.free;
    let creditosGeminiTotal = creditosGemini;

    const email = req.session.user?.email;
    if (email) {
        try {
            const snap = await db.collection('clientes_premium').doc(email.toLowerCase()).get();
            if (snap.exists) {
                const d = snap.data();
                if (d.creditos !== undefined) {
                    const expirado = d.creditos_expira_em && new Date(d.creditos_expira_em) < new Date();
                    creditosGemini = expirado ? 0 : d.creditos;
                }
                if (d.creditos_ciclo_total !== undefined) creditosGeminiTotal = d.creditos_ciclo_total;
            }
        } catch (_) { /* degradação silenciosa */ }
    }

    res.render('pages/dashboard/solaris', {
        user:       req.session.user,
        titulo:     'Solaris Code | Softload',
        activePage: 'solaris',
        creditosGemini,
        creditosGeminiTotal,
    });
});

// ──────────────────────────────────────────────────────────────────────────
// POST /dashboard/solaris/chat/stream — mesmo protocolo de eventos SSE
// genérico usado em todo o projeto (status/chunk/done/error). Streaming
// real (Fase 2) via solarisChat.perguntarStream — cada trecho de texto
// do Gemini vira um evento "chunk" assim que chega.
// ──────────────────────────────────────────────────────────────────────────
router.post('/dashboard/solaris/chat/stream', exigirLogin, verificarSaldo, async (req, res) => {
    const { message, history, sessionId: clientSessionId } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });
    }
    if (message.trim().length > 2000) {
        return res.status(400).json({ error: 'Mensagem muito longa. Máximo 2000 caracteres.' });
    }

    const msg       = message.trim();
    const uid       = req.session.user?.uid;
    const email     = req.session.user?.email || '';
    const sessionId = clientSessionId || chatStorage.newSessionId();

    const safeHistory = Array.isArray(history)
        ? history.filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant')).slice(-10)
        : [];
    const historicoSolaris = safeHistory.map((h) => ({
        autor: h.role === 'user' ? 'usuario' : 'solaris',
        texto: h.content,
    }));

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    let fullText     = '';
    let tokensRef    = { total: 0, input: 0, output: 0 };
    let replyFinal   = '';
    let zipInfo      = null;
    let tokensGeracao = { input: 0, output: 0 }; // estimativa — ver comentário abaixo
    // Propostas de mudança de arquivo pendentes de confirmação (Fase 2d,
    // ver pipeline/projectEditor.js) — carregadas do meta da sessão
    // ANTERIOR dentro do bloco de projeto abaixo, e regravadas no `finally`
    // no fim da função. Continua [] o turno inteiro se não há projeto
    // anexado (nunca existiu proposta pra essa sessão).
    let propostasPendentes = [];

    try {
        // Fase 2c/2d: se a sessão tem um projeto anexado (upload anterior
        // persistido no GCS via tools/projectStorage.js), o turno inteiro
        // passa pro editor agêntico (leitura + proposta/aplicação de
        // mudança de arquivo — ver pipeline/projectEditor.js) em vez do
        // chat normal. Tentativa SEMPRE que uid existe (nunca depende de o
        // cliente avisar que anexou algo — evita todo o bug de "esqueceu
        // de mandar a flag"); custo é só um GET no GCS quando não há
        // projeto (404 rápido). Sem streaming token-a-token nesse caminho
        // (executarTarefaComFerramentas não é streaming) — manda a
        // resposta inteira num único evento "chunk", mesmo protocolo SSE,
        // só sem o efeito de digitação.
        let usouProjeto = false;
        if (uid) {
            const baseDirProjeto = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projeto-anexado-'));
            try {
                const projeto = await carregarProjeto(uid, sessionId, baseDirProjeto);
                if (projeto) {
                    try {
                        const sessaoAnterior = await chatStorage.loadSession(uid, SOLARIS_CHAT_SESSION_TYPE, sessionId);
                        propostasPendentes = sessaoAnterior?.meta?.edicaoProjetoPendente || [];
                    } catch (e) {
                        console.warn(`[SOLARIS-CHAT] falha carregando propostas pendentes: ${e.message}`);
                    }

                    const aplicarMudancasReal = async (mudancas) => {
                        for (const m of mudancas) {
                            if (m.operacao === 'deletar') deletarArquivo(baseDirProjeto, m.caminho);
                            else criarArquivo(baseDirProjeto, m.caminho, m.conteudoNovo);
                        }
                        const caminhosAtualizados = listarProjeto(baseDirProjeto);
                        const arquivosAtualizados = caminhosAtualizados.map((caminho) => {
                            const r = lerArquivo(baseDirProjeto, caminho);
                            return { caminho, conteudo: r.ok ? r.conteudo : '' };
                        });
                        // Mesmo padrão de substituição da rota de upload
                        // (apagarProjeto + salvarProjeto) — reusa a cota já
                        // testada em vez de inventar escrita cirúrgica por
                        // arquivo no GCS (projeto Solaris é pequeno, poucas
                        // dezenas de arquivo de texto, ver README).
                        await apagarProjeto(uid, sessionId);
                        await salvarProjeto({ uid, email, plano: req.session.user?.plano || 'free', sessionId, framework: projeto.framework, arquivos: arquivosAtualizados });
                    };

                    sendEvent({ type: 'status', label: 'Consultando o projeto anexado...' });
                    const resposta = await responderOuEditarProjeto({
                        baseDir: baseDirProjeto,
                        framework: projeto.framework,
                        arquivos: projeto.arquivos,
                        mensagem: msg,
                        historico: historicoSolaris,
                        propostasPendentes,
                        modelRouter,
                        aplicarMudancasReal,
                    });
                    if (resposta.ok) {
                        fullText = resposta.resposta;
                        sendEvent({ type: 'chunk', text: fullText });
                        tokensRef.total  = resposta.tokens.total;
                        tokensRef.input  = resposta.tokens.input;
                        tokensRef.output = resposta.tokens.output;
                        usouProjeto = true;
                        propostasPendentes = resposta.propostasFinais;

                        // Achado real testando a Fase 2d: mudancasAplicadas
                        // era calculado por projectEditor.js mas nunca
                        // chegava ao usuário — mesma classe de bug já
                        // corrigida no chat de edição do Workspace ("só
                        // promete e diz que mudou"). baseDirProjeto já
                        // reflete o estado atualizado (aplicarMudancasReal
                        // grava nele antes de persistir no GCS), então dá
                        // pra reusar o MESMO mecanismo de download que
                        // "projeto gerado" já usa (event.zip no 'done') —
                        // zero mudança de frontend necessária.
                        if (resposta.mudancasAplicadas.length > 0) {
                            try {
                                const zipBuffer = await criarZip(baseDirProjeto);
                                zipInfo = {
                                    base64:        zipBuffer.toString('base64'),
                                    nome:          'projeto-solaris-atualizado.zip',
                                    totalArquivos: listarProjeto(baseDirProjeto).length,
                                };
                            } catch (e) {
                                console.warn(`[SOLARIS-CHAT] falha gerando ZIP do projeto editado: ${e.message}`);
                            }
                        }
                    } else {
                        console.warn(`[SOLARIS-CHAT] responderOuEditarProjeto indisponível: ${resposta.motivo}`);
                    }
                }
            } catch (e) {
                console.warn(`[SOLARIS-CHAT] falha carregando projeto anexado: ${e.message}`);
            } finally {
                fs.rmSync(baseDirProjeto, { recursive: true, force: true });
            }
        }

        if (!usouProjeto) {
            sendEvent({ type: 'status', label: 'Consultando o Solaris...' });

            for await (const pedaco of solarisChat.perguntarStream(msg, historicoSolaris, tokensRef)) {
                fullText += pedaco;
                sendEvent({ type: 'chunk', text: pedaco });
            }
        }

        // Nunca deixa um marcador cortado no meio (usuário parou a geração,
        // ou o teto de tokens cortou a resposta) vazar pro texto exibido.
        fullText = removerMarcadorTruncado(fullText);

        const marcador = detectarMarcador(fullText);
        replyFinal = fullText;

        if (marcador) {
            replyFinal = marcador.textoVisivel;

            if (marcador.erro) {
                // Marcador malformado (JSON inválido/campo ausente) — não
                // trava a conversa, só não dispara geração nenhuma.
                console.error(`[SOLARIS-CHAT] marcador de geração malformado: ${marcador.erro}`);
            } else {
                sendEvent({ type: 'status', label: 'Gerando o projeto...' });

                const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projeto-'));
                try {
                    const resultado = await orquestrador.gerarProjeto({
                        objetivo:  marcador.objetivo,
                        framework: marcador.framework,
                        baseDir,
                    });

                    if (resultado.ok && resultado.zipBuffer) {
                        zipInfo = {
                            base64:        resultado.zipBuffer.toString('base64'),
                            nome:          'projeto-solaris.zip',
                            totalArquivos: resultado.arquivos.length,
                        };

                        // orchestrator.js ainda não expõe usageMetadata real por
                        // chamada de arquitetura (Pro) pro caller — estimativa
                        // pela mesma heurística de caracteres já usada como
                        // fallback no resto do projeto, pra nunca deixar o custo
                        // real de Pro (manifesto + 1 chamada por arquivo) sem
                        // cobrança nenhuma.
                        const textoGerado = resultado.arquivos.map((a) => a.conteudo || '').join('');
                        tokensGeracao.output = Math.ceil(textoGerado.length / 3.5);
                        tokensGeracao.input  = Math.ceil((marcador.objetivo.length + marcador.framework.length) / 3.5) * (1 + resultado.arquivos.length);
                    } else {
                        replyFinal += '\n\n⚠️ Não consegui empacotar o projeto — algum arquivo não passou na validação automática. Me diga o que você quer ajustar e eu tento de novo.';
                    }
                } finally {
                    fs.rmSync(baseDir, { recursive: true, force: true });
                }
            }
        }

        sendEvent({ type: 'done', reply: replyFinal, sessionId, tokens: tokensRef, zip: zipInfo });

    } catch (err) {
        const httpStatus = err.status || err.statusCode || 0;
        console.error(`[SOLARIS-CHAT] status=${httpStatus} msg=${err.message}`);

        const allErrMsg = err.message || '';
        const isCota      = httpStatus === 429 || allErrMsg.includes('429') || allErrMsg.includes('RESOURCE_EXHAUSTED') || allErrMsg.includes('quota');
        const isSeguranca = allErrMsg.includes('SAFETY') || allErrMsg.includes('content_filter');
        const isChave     = httpStatus === 401 || allErrMsg.includes('API_KEY') || allErrMsg.includes('UNAUTHENTICATED') || allErrMsg.includes('não configurada');

        if (isChave) {
            db.collection('admin_logs').add({
                por:       'sistema',
                tipo:      'erro_solaris',
                detalhes:  { email: email || 'desconhecido', status: httpStatus, erro: err.message?.slice(0, 300) },
                criado_em: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {});
        }

        sendEvent({
            type:    'error',
            message: isCota      ? 'Alto volume de acessos. Aguarde 1 minuto e tente novamente.'
                   : isSeguranca ? 'Mensagem não pôde ser processada. Reformule e tente novamente.'
                   : isChave     ? 'Chave de API inválida ou expirada. Verifique GEMINI_API_KEY no servidor.'
                   :               `Solaris temporariamente indisponível. (${httpStatus || 'err'}) Tente novamente.`,
        });
    } finally {
        res.end();

        // Se algo quebrou antes do marcador ser resolvido, replyFinal pode
        // ainda estar vazio — cai pro fullText bruto (já sem marcador
        // truncado, ver removerMarcadorTruncado acima) pra nunca perder o
        // texto que o usuário efetivamente recebeu via streaming.
        const textoParaSalvar = replyFinal || fullText;

        if (textoParaSalvar && uid) {
            const ts       = new Date().toISOString();
            const messages = [
                ...safeHistory,
                { role: 'user',      content: msg,             ts },
                { role: 'assistant', content: textoParaSalvar, ts },
            ];
            // meta.edicaoProjetoPendente: propostas de mudança de arquivo
            // ainda não confirmadas (ver pipeline/projectEditor.js) —
            // precisam sobreviver pro próximo turno decidir se aplica ou
            // cancela. [] na maioria das sessões (nunca houve projeto
            // anexado, ou não há nada pendente agora).
            const meta = propostasPendentes.length ? { edicaoProjetoPendente: propostasPendentes } : {};
            chatStorage.saveSession(uid, SOLARIS_CHAT_SESSION_TYPE, sessionId, { messages, tokens: tokensRef, meta }, { email, plano: req.session.user?.plano || 'free' })
                .catch((e) => console.error(`[CHAT-STORAGE] solaris-chat save err: ${e.message}`));
        }

        // Débito separado do save — roda sempre que houver resposta e email
        // (mesmo padrão de chat.js/workspaceChat.js). tokensRef vem do
        // usageMetadata real do Gemini (ver modelRouter.executarTriagemStream);
        // heurística de caracteres só entra se por algum motivo a API não
        // devolveu usageMetadata nenhum (fallback, não o caminho normal).
        // tokensGeracao (Pro, manifesto + arquivos) é sempre estimativa —
        // ver comentário na chamada de gerarProjeto — somado no mesmo débito
        // pra nunca deixar o custo real de geração sem cobrança.
        if (email && textoParaSalvar) {
            const inputToks  = (tokensRef.input  > 0 ? tokensRef.input  : Math.ceil(msg.length / 3.5)) + tokensGeracao.input;
            const outputToks = (tokensRef.output > 0 ? tokensRef.output : Math.ceil(textoParaSalvar.length / 3.5)) + tokensGeracao.output;
            debitarCreditos(email, inputToks, outputToks)
                .catch((e) => console.error(`[BILLING] solaris-chat debit err: ${e.message}`));
        }
    }
});

// ──────────────────────────────────────────────────────────────────────────
// POST /dashboard/solaris/upload — detector de framework a partir de
// upload (ver src/solaris/README.md). Princípio de segurança: todo
// arquivo enviado pelo usuário é tratado como malicioso até prova em
// contrário — o conteúdo extraído NUNCA é executado, NUNCA passa por
// eval/require/child_process. Ele só vira TEXTO puro, lido como string
// pra alimentar frameworkDetector.js (regex/sinal estrutural, mesmo
// jeito que um humano leria o código colado num chat). O diretório
// temporário de extração é sempre apagado no finally, nunca persiste
// além da vida do request — mesmo padrão já usado pro ZIP de geração
// (Fase 3, ver mais acima neste arquivo).
//
// multer (memoryStorage) faz o parse do multipart — nunca escreve o
// upload bruto em disco antes da validação. extrairZip() (fileTools.js)
// é quem de fato decide se o conteúdo é seguro: valida o zip INTEIRO
// (nome de entrada, tamanho declarado e real, contagem de arquivo)
// ANTES de escrever qualquer byte em disco — rejeição é atômica, não
// deixa arquivo parcial gravado.
//
// Fase 2b: depois da detecção determinística, um loop de tool-calling
// (pipeline/projectInspector.js, Gemini Pro) lê/lista/busca de verdade
// nos arquivos extraídos — SOMENTE LEITURA, mesmo baseDir, mesma vida
// de requisição — e devolve um resumo em texto (`analiseIA`). Cobra
// crédito real (verificarSaldo/debitarCreditos, mesmo pool do resto do
// Solaris) só quando a inspeção de fato roda; falha da IA nunca derruba
// a resposta — a detecção de framework é sempre determinística.
// ──────────────────────────────────────────────────────────────────────────
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // 15MB no arquivo .zip em si (compactado)

const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos antes de tentar de novo.' }),
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        // Gate de UX, não de segurança — mimetype/nome vêm do cliente,
        // trivialmente falsificável. A validação de verdade é
        // extrairZip() tentando abrir o buffer como zip real.
        if (!/\.zip$/i.test(file.originalname || '')) {
            cb(new Error('Envie um arquivo .zip.'));
            return;
        }
        cb(null, true);
    },
});

router.post('/dashboard/solaris/upload', exigirLogin, uploadLimiter, verificarSaldo, (req, res) => {
    upload.single('arquivo')(req, res, async (errUpload) => {
        if (errUpload) {
            const msg = errUpload.code === 'LIMIT_FILE_SIZE'
                ? `Arquivo grande demais — limite de ${Math.floor(UPLOAD_MAX_BYTES / 1024 / 1024)}MB.`
                : (errUpload.message || 'Falha ao processar o upload.');
            return res.status(400).json({ error: msg });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        }

        const uid       = req.session.user?.uid;
        const email     = req.session.user?.email || '';
        const sessionId = req.body.sessionId || chatStorage.newSessionId();

        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-upload-'));
        try {
            await extrairZip(baseDir, req.file.buffer);

            const caminhos = listarProjeto(baseDir);
            const arquivos = caminhos.map((caminho) => {
                const r = lerArquivo(baseDir, caminho);
                return { caminho, conteudo: r.ok ? r.conteudo : null };
            });

            const { melhorPalpite, candidatos } = detectarFramework(arquivos);

            // Inspeção por IA (Fase 2b) — roda DENTRO desta mesma requisição,
            // contra o baseDir que ainda está de pé (apagado no finally
            // logo abaixo, nunca sobrevive além deste request — ver
            // pipeline/projectInspector.js). Nunca lança por contrato; uma
            // falha (cota, chave, timeout) só significa analiseIA:null — a
            // detecção determinística de framework acima nunca depende
            // disso pra responder.
            const inspecao = await inspecionarProjeto({ baseDir, framework: melhorPalpite, arquivos: caminhos, modelRouter });
            if (!inspecao.ok) {
                console.warn(`[SOLARIS-UPLOAD] inspeção de projeto indisponível: ${inspecao.motivo}`);
            }

            if (email && inspecao.ok && (inspecao.tokens.input || inspecao.tokens.output)) {
                debitarCreditos(email, inspecao.tokens.input, inspecao.tokens.output)
                    .catch((e) => console.error(`[BILLING] solaris-upload debit err: ${e.message}`));
            }

            // Fase 2c: persiste o projeto no GCS sob a sessão de chat (ver
            // tools/projectStorage.js) — permite que um turno de chat
            // SEGUINTE pergunte sobre um arquivo específico. Substitui
            // qualquer projeto anterior da mesma sessão (nunca acumula
            // mais de um por sessão). Nunca bloqueia a resposta de upload
            // — se a cota estourar ou o GCS falhar, o usuário ainda recebe
            // a detecção de framework e a análise normalmente, só sem o
            // anexo persistido (próxima pergunta cai no chat normal, sem
            // contexto de arquivo).
            let temProjeto = false;
            if (uid) {
                try {
                    await apagarProjeto(uid, sessionId);
                    await salvarProjeto({ uid, email, plano: req.session.user?.plano || 'free', sessionId, framework: melhorPalpite, arquivos });
                    temProjeto = true;
                } catch (e) {
                    console.warn(`[SOLARIS-UPLOAD] não foi possível persistir o projeto: ${e.message}`);
                }
            }

            res.json({
                ok: true,
                framework: melhorPalpite,
                candidatos: candidatos.map((c) => ({ framework: c.framework, score: c.score, evidencias: c.evidencias })),
                totalArquivos: arquivos.length,
                arquivos: caminhos.slice(0, 50), // amostra — nunca devolve conteúdo, só nome
                analiseIA: inspecao.ok ? inspecao.resumo : null,
                sessionId,
                temProjeto,
            });
        } catch (err) {
            // extrairZip só rejeita por motivo de entrada do usuário (zip
            // inválido, zip-slip, tamanho/contagem acima do limite) — 400,
            // nunca 500, nunca vaza detalhe de path do servidor.
            console.warn(`[SOLARIS-UPLOAD] rejeitado: ${err.message}`);
            res.status(400).json({ error: 'Não foi possível processar o arquivo — confira se é um .zip válido e dentro dos limites de tamanho.' });
        } finally {
            fs.rmSync(baseDir, { recursive: true, force: true });
        }
    });
});

router.SOLARIS_CHAT_SESSION_TYPE = SOLARIS_CHAT_SESSION_TYPE;
module.exports = router;
