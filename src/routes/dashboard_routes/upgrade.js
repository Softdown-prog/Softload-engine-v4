'use strict';
const express     = require('express');
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

router.get('/dashboard/upgrade', exigirLogin, (req, res) => {
    res.render('pages/upgrade', {
        user:        req.session.user,
        titulo:      'Escolha seu Plano | Softload',
        query:       req.query,
        mpPublicKey: process.env.MP_PUBLIC_KEY || '',
    });
});

module.exports = router;
