const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { db } = require('../services/firebase');
const { concederCreditos, concederCreditosGpt, concederCreditosBloggerAi, PLAN_CREDITS } = require('../services/creditService');
const { enviarPlanoAtivado }              = require('../services/emailService');
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
const { exigirLogin } = require('../middlewares/authGuard');
const { apagarProjetosExpirados } = require('../solaris/tools/projectStorage');

// Rate limit por IP nas rotas de iniciar pagamento — já exigem login
// (exigirLogin), mas sem limite um usuário autenticado podia disparar
// criação de preferência/pagamento em loop. Resposta em JSON (default do
// express-rate-limit), consistente com o resto destas duas rotas —
// diferente de authRoutes.js, que são POST de formulário HTML.
// Deliberadamente NÃO aplicado no webhook do Mercado Pago: aquele
// endpoint é chamado pelo próprio MP (não por um usuário final), já tem
// verificação de assinatura HMAC fail-closed, e um rate limit por IP ali
// arriscaria descartar notificações legítimas em retry de alto volume.
const pagamentoLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas de pagamento em pouco tempo. Aguarde alguns minutos e tente novamente.' },
});

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});
const payment = new Payment(client);
const preference = new Preference(client);

// Contract: Provides the React frontend with context previously injected via res.locals
router.get('/api/app-config', (req, res) => {
    res.json({
        user: req.session.user || null,
        firebaseConfig: {
            apiKey: process.env.FIREBASE_API_KEY,
            appId: process.env.FIREBASE_APP_ID,
        },
        features: {
            mpCheckoutUrl: process.env.MP_CHECKOUT_URL || '#'
        }
    });
});

// ==========================================
// HMAC do webhook do Mercado Pago
// Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
// Cabeçalho x-signature contém ts=...,v1=<hmac sha256 do manifesto>
// ==========================================
function verificarAssinaturaMP(req) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
        // Sem secret configurado, recusa por padrão (fail-closed) em produção
        if (process.env.NODE_ENV === 'production') {
            console.warn('[MP] MP_WEBHOOK_SECRET não configurado — webhook recusado em produção.');
            return false;
        }
        // Em dev/staging, sem secret, aceita para não quebrar testes locais
        console.warn('[MP] MP_WEBHOOK_SECRET não configurado — verificação de assinatura desativada.');
        return true;
    }

    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    if (!signature || typeof signature !== 'string') return false;

    // Extrai ts e v1 do header (formato "ts=...,v1=...")
    const partes = Object.fromEntries(
        signature.split(',').map(p => {
            const i = p.indexOf('=');
            return i === -1 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
        })
    );
    const ts = partes.ts;
    const v1 = partes.v1;
    if (!ts || !v1) return false;

    // O id no manifesto é o data.id passado na query string (?data.id=...) ou no body
    const dataId = req.query?.['data.id'] || req.body?.data?.id || req.body?.id;
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

// ==========================================
// POST /dashboard/checkout-create — Cria preferência de pagamento
// ==========================================

router.post('/dashboard/checkout-create', exigirLogin, pagamentoLimiter, async (req, res) => {
    try {
        const user = req.session.user;
        const { plano } = req.body;

        if (!user || !user.email) {
            return res.status(401).json({ erro: 'Usuário não autenticado' });
        }

        const PLANOS = {
            starter: { titulo: 'Plano Starter — Softload Engine', preco:  49.00, creditos: PLAN_CREDITS.starter },
            pro:     { titulo: 'Plano Pro — Softload Engine',     preco: 119.00, creditos: PLAN_CREDITS.pro },
            studio:  { titulo: 'Plano Studio — Softload Engine',  preco: 249.00, creditos: PLAN_CREDITS.studio },
        };

        if (!PLANOS[plano]) {
            return res.status(400).json({ erro: 'Plano inválido. Use "starter", "pro" ou "studio".' });
        }

        const planoConfig = PLANOS[plano];

        // Salva o plano pendente para o webhook recuperar após pagamento aprovado.
        // set+merge cria o doc se não existir — .update() lançaria NOT_FOUND para usuários novos.
        try {
            await db.collection('clientes_premium').doc(user.email.toLowerCase()).set({ plano_pendente: plano }, { merge: true });
        } catch (e) {
            console.warn('[MP] Falha ao salvar plano_pendente:', e.message);
        }

        // Base URL: deriva do próprio request (Cloud Run → https + domínio real).
        // Remove dependência de BASE_URL e evita localhost ser enviado ao MP.
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const ehHttps = baseUrl.startsWith('https://');

        // Configura a preferência de pagamento
        const preferenceData = {
            items: [
                {
                    title:       planoConfig.titulo,
                    description: `${planoConfig.creditos} créditos de IA por mês. Válido por 30 dias.`,
                    quantity:    1,
                    unit_price:  planoConfig.preco,
                }
            ],
            payer: {
                email: user.email,
                name: user.nome || 'Cliente'
            },
            external_reference: user.email, // Para identificar o usuário no webhook
            back_urls: {
                success: process.env.CALLBACK_URL_SUCCESS || `${baseUrl}/dashboard/upgrade?status=success`,
                failure: process.env.CALLBACK_URL_FAILURE || `${baseUrl}/dashboard/upgrade?status=failure`,
                pending: process.env.CALLBACK_URL_PENDING || `${baseUrl}/dashboard/upgrade?status=pending`
            },
        };

        // auto_return e notification_url só são aceitos pelo MP com URL HTTPS pública.
        // Em localhost (dev) são omitidos para não fazer o MP rejeitar a preferência.
        if (ehHttps) {
            preferenceData.auto_return     = 'approved';
            preferenceData.notification_url = `${baseUrl}/webhook/mercado-pago`;
        }

        // Cria a preferência no Mercado Pago
        const response = await preference.create({ body: preferenceData });

        if (!response.init_point) {
            console.error('[MP] Resposta sem init_point:', JSON.stringify(response));
            return res.status(500).json({ erro: 'Falha ao gerar link de pagamento' });
        }

        console.log(`[MP] Preferência criada para ${user.email} — ID: ${response.id} — baseUrl=${baseUrl}`);

        res.json({
            sucesso: true,
            checkoutUrl: response.init_point,
            preferenceId: response.id
        });

    } catch (error) {
        // Surfacing detalhado: o SDK do MP traz a causa real em error.cause ou error.message
        const detalheMp = error?.cause?.[0]?.description
            || error?.cause?.message
            || error?.message
            || 'erro desconhecido';
        console.error('[MP] Erro ao criar preferência:', detalheMp, '| status:', error?.status || error?.statusCode || '');
        res.status(500).json({ erro: `Falha ao gerar pagamento: ${detalheMp}` });
    }
});

// ==========================================
// POST /dashboard/payment/process — Checkout Bricks
// Recebe formData tokenizado do Brick, cria o pagamento na API do MP
// e retorna o resultado (aprovado, pendente Pix/boleto ou rejeitado).
// A ativação real do plano acontece via webhook (fluxo assíncrono).
// ==========================================
router.post('/dashboard/payment/process', exigirLogin, pagamentoLimiter, async (req, res) => {
    try {
        const { formData, plano } = req.body || {};
        const user = req.session.user;

        const PLANOS_VALIDOS = { starter: 49.00, pro: 119.00, studio: 249.00 };
        if (!plano || !PLANOS_VALIDOS[plano]) {
            return res.status(400).json({ erro: 'Plano inválido.' });
        }
        if (!formData || typeof formData !== 'object') {
            return res.status(400).json({ erro: 'Dados de pagamento inválidos.' });
        }

        // Persiste plano_pendente para o webhook ler após confirmação
        try {
            await db.collection('clientes_premium').doc(user.email.toLowerCase()).update({ plano_pendente: plano });
        } catch (e) {
            console.warn('[MP] Falha ao salvar plano_pendente:', e.message);
        }

        const paymentBody = {
            ...formData,
            transaction_amount: PLANOS_VALIDOS[plano],
            description:        `Softload Engine — Plano ${plano.charAt(0).toUpperCase() + plano.slice(1)}`,
            external_reference: user.email.toLowerCase(),
        };

        const result = await payment.create({ body: paymentBody });

        console.log(`[MP-BRICKS] Pagamento criado: id=${result.id} status=${result.status} plano=${plano} email=${user.email}`);

        // Pix — retorna QR code para o front exibir
        if (result.payment_method_id === 'pix' || result.status === 'pending') {
            const pix = result.point_of_interaction?.transaction_data;
            return res.json({
                status:       result.status,
                id:           result.id,
                pixQrCode:    pix?.qr_code      || null,
                pixQrBase64:  pix?.qr_code_base64 || null,
                boletoUrl:    result.transaction_details?.external_resource_url || null,
            });
        }

        // Aprovado ou rejeitado direto
        res.json({ status: result.status, id: result.id });

    } catch (error) {
        console.error('[MP-BRICKS] Erro ao processar pagamento:', error.message);
        res.status(500).json({ erro: 'Falha ao processar pagamento. Tente novamente.' });
    }
});

// ==========================================
// WEBHOOK MERCADO PAGO
// ==========================================

router.post('/webhook/mercado-pago', async (req, res) => {
    // Recusa assinaturas inválidas — bloqueia ataques de webhook forjado
    if (!verificarAssinaturaMP(req)) {
        console.warn('[MP] Assinatura HMAC inválida — possível tentativa de fraude.');
        return res.status(403).send('Forbidden');
    }

    try {
        const { action, type, data } = req.body;

        if (action === 'payment.created' || type === 'payment' || action === 'payment.updated') {
            const paymentId = data ? data.id : req.body.id;

            console.log(`[MP] Verificando pagamento: ${paymentId}`);

            // Consulta back-channel — nunca confia no body
            const paymentDetails = await payment.get({ id: paymentId });

            if (paymentDetails.status === 'approved') {
                const emailCliente = paymentDetails.external_reference?.trim().toLowerCase();

                if (!emailCliente) {
                    console.warn('[MP] Pagamento aprovado mas sem external_reference (e-mail).');
                    return res.status(200).send('OK');
                }

                console.log(`[MP] Pagamento aprovado: ${emailCliente}`);

                // Busca o usuário pelo campo email (compatível com doc ID = email ou UID)
                const query = await db.collection('clientes_premium')
                    .where('email', '==', emailCliente)
                    .limit(1)
                    .get();

                if (query.empty) {
                    console.warn(`[MP] Usuário ${emailCliente} não encontrado na base.`);
                    return res.status(200).send('OK');
                }

                const userRef = query.docs[0].ref;
                const userData = query.docs[0].data();

                // Idempotência — evita processar pagamento duplicado
                if (userData.mp_payment_id === String(paymentId)) {
                    console.log(`[MP] Pagamento ${paymentId} já processado. Ignorando.`);
                    return res.status(200).send('OK');
                }

                // Calcula a data de vencimento (30 dias a partir de hoje)
                const premiumAte = new Date();
                premiumAte.setDate(premiumAte.getDate() + 30);

                // Determina o plano pelo campo plano_pendente (salvo no checkout-create).
                // Sem fallback 'pro' — se plano_pendente estiver ausente, loga e retorna OK
                // para não ativar um plano errado silenciosamente.
                const planoAtivado = userData.plano_pendente;
                if (!planoAtivado) {
                    console.error(`[MP] plano_pendente ausente para ${emailCliente} — pagamento ${paymentId} não ativado.`);
                    return res.status(200).send('OK');
                }

                await userRef.update({
                    plano: planoAtivado,
                    is_active: true,
                    status: 'ativo',
                    premium_ate: premiumAte.toISOString(),
                    mp_payment_id: String(paymentId),
                    plano_pendente: null,
                    ultima_atualizacao: new Date().toISOString()
                });

                // Aloca créditos e envia email de confirmação — fire-and-forget
                const creditos = PLAN_CREDITS[planoAtivado] ?? PLAN_CREDITS.pro;
                concederCreditosGpt(emailCliente, planoAtivado)
                    .catch(e => console.error('[MP] Falha ao conceder créditos GPT:', e.message));

                concederCreditosBloggerAi(emailCliente, planoAtivado)
                    .catch(e => console.error('[MP] Falha ao conceder créditos BloggerAI:', e.message));

                concederCreditos(emailCliente, planoAtivado)
                    .then(({ expira_em }) => {
                        enviarPlanoAtivado(
                            emailCliente,
                            userData.nome || '',
                            planoAtivado,
                            creditos,
                            expira_em
                        ).catch(e => console.error('[EMAIL] Plano ativado falhou:', e.message));
                    })
                    .catch(e => console.error('[MP] Falha ao conceder créditos:', e.message));

                // Atualiza qualquer sessão ativa do usuário no Firestore — UX:
                // o cliente que está logado vê o premium ser liberado sem precisar deslogar.
                try {
                    const sessionsSnap = await db.collection('sessions')
                        .where('sess.user.email', '==', emailCliente)
                        .get();
                    if (!sessionsSnap.empty) {
                        const batch = db.batch();
                        sessionsSnap.docs.forEach(sDoc => {
                            const sess = sDoc.data().sess;
                            if (sess && sess.user) {
                                sess.user.plano = planoAtivado;
                                sess.user.is_active = true;
                                sess.user.premium_ate = premiumAte.toISOString();
                                batch.update(sDoc.ref, { sess });
                            }
                        });
                        await batch.commit();
                    }
                } catch (sessErr) {
                    console.warn('[MP] Falha ao atualizar sessões ativas:', sessErr.message);
                }

                console.log(`[MP] ${emailCliente} ativado como ${planoAtivado.toUpperCase()} até ${premiumAte.toDateString()}`);
            }
        }

        res.status(200).send('OK');

    } catch (error) {
        console.error('[MP] Erro no webhook:', error.message);

        // Erros de infraestrutura retornam 500 para o MP retentar
        // Erros de lógica retornam 200 para o MP não retentar
        const isInfraError = error.message?.includes('UNAVAILABLE') ||
                             error.message?.includes('DEADLINE_EXCEEDED') ||
                             error.message?.includes('fetch');

        res.status(isInfraError ? 500 : 200).send(isInfraError ? 'Erro de infraestrutura' : 'OK');
    }
});

// ==========================================
// Limpeza interna — TTL de projetos Solaris persistidos
// Chamado por Cloud Scheduler (ou manualmente/`npm run
// solaris:limpar-projetos-expirados`) — nunca por usuário final. Sem
// corpo assinável vindo do Scheduler (diferente do webhook do MP acima),
// então a autenticação é por secret compartilhado num header fixo —
// mesma postura fail-closed em produção.
// ==========================================
function verificarSegredoLimpezaSolaris(req) {
    const secret = process.env.SOLARIS_CLEANUP_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            console.warn('[SOLARIS-CLEANUP] SOLARIS_CLEANUP_SECRET não configurado — recusado em produção.');
            return false;
        }
        console.warn('[SOLARIS-CLEANUP] SOLARIS_CLEANUP_SECRET não configurado — verificação desativada (dev).');
        return true;
    }

    const recebido = req.headers['x-solaris-cleanup-secret'];
    if (typeof recebido !== 'string' || recebido.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(secret));
}

router.post('/internal/solaris/limpar-projetos-expirados', async (req, res) => {
    if (!verificarSegredoLimpezaSolaris(req)) {
        return res.status(403).send('Forbidden');
    }

    try {
        const diasArg = Number(req.query.dias);
        const opcoes = Number.isFinite(diasArg) && diasArg > 0 ? { diasParaExpirar: diasArg } : {};
        const resultado = await apagarProjetosExpirados(opcoes);
        console.log(`[SOLARIS-CLEANUP] ${resultado.apagados.length} projeto(s) expirado(s) removido(s), ${resultado.erros.length} erro(s).`);
        res.status(200).json(resultado);
    } catch (err) {
        console.error('[SOLARIS-CLEANUP] falhou:', err.message);
        res.status(500).json({ erro: 'Falha ao limpar projetos expirados.' });
    }
});

module.exports = router;
