'use strict';
const express     = require('express');
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

router.get('/dashboard/configuracoes', exigirLogin, (req, res) => {
    res.render('pages/dashboard/configuracoes', {
        user:       req.session.user,
        titulo:     'Configurações | Softload',
        activePage: 'configuracoes',
        query:      req.query
    });
});

module.exports = router;
