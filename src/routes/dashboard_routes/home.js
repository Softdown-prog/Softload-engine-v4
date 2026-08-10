'use strict';
const express         = require('express');
const router          = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
const { db }          = require('../../services/firebase');
const { PLAN_CREDITS, GPT_PLAN_CREDITS } = require('../../services/creditService');
const { STORAGE_LIMITS_MB } = require('../../services/storageService');

router.get('/dashboard', exigirLogin, async (req, res) => {
    const user  = req.session.user;
    const email = user.email.toLowerCase();

    let creditos               = 0;
    let creditosCicloTotal     = PLAN_CREDITS[user.plano]     ?? PLAN_CREDITS.free;
    let creditosExpiraEm       = null;
    let creditosGpt            = 0;
    let creditosGptCicloTotal  = GPT_PLAN_CREDITS[user.plano] ?? 0;
    let creditosGptExpiraEm    = null;
    let totalProjetos          = 0;

    try {
        const [userSnap, projetosSnap] = await Promise.all([
            db.collection('clientes_premium').doc(email).get(),
            db.collection('clientes_premium').doc(email)
                .collection('projetos')
                .count()
                .get(),
        ]);

        if (userSnap.exists) {
            const d = userSnap.data();
            creditos              = d.creditos              ?? 0;
            creditosCicloTotal    = d.creditos_ciclo_total  ?? creditosCicloTotal;
            creditosExpiraEm      = d.creditos_expira_em    ?? null;

            const gptExpirado = d.creditos_gpt_expira_em && new Date(d.creditos_gpt_expira_em) < new Date();
            creditosGpt           = gptExpirado ? 0 : (d.creditos_gpt ?? 0);
            creditosGptCicloTotal = d.creditos_gpt_ciclo_total ?? creditosGptCicloTotal;
            creditosGptExpiraEm   = gptExpirado ? null : (d.creditos_gpt_expira_em ?? null);
        }

        totalProjetos = projetosSnap.data().count ?? 0;
    } catch (e) {
        console.warn('[DASHBOARD] Falha ao buscar dados:', e.message);
    }

    res.render('pages/dashboard', {
        user,
        titulo:            'Painel de Controle | Softload',
        activePage:        'home',
        creditos,
        creditosCicloTotal,
        creditosExpiraEm,
        creditosGpt,
        creditosGptCicloTotal,
        creditosGptExpiraEm,
        storageLimitMb:    STORAGE_LIMITS_MB[user.plano] ?? STORAGE_LIMITS_MB.free,
        totalProjetos,
    });
});

module.exports = router;
