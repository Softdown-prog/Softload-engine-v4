'use strict';

// ==========================================
// LAYOUT (footer / sidebar)
// ==========================================

/**
 * Gera CSS de layout (footer / sidebar) controlado por classes no <body>.
 *
 * Os chassis ativos têm estrutura hardcoded (col-lg-8 + col-lg-4, footer com
 * col-md-4×3). Em vez de cirurgia estrutural em cada chassis, injetamos uma
 * classe no <body> ([[BODY_LAYOUT_CLASS]]) e este CSS reage a ela.
 *
 * Robusto por design:
 *  - sidebar usa `order` em flex-children (a .row do Bootstrap é flex) — sem :has
 *  - onde não há sidebar/footer (portfolio/saas/biolink) o seletor simplesmente
 *    não casa, então é inócuo.
 *
 * Só emite a regra do estado escolhido (mantém o output enxuto e o trace fiel).
 */
function gerarLayoutCss({ footerStyle, sidebarPosition }) {
    let css = '';
    if (sidebarPosition === 'none') {
        css += `
    body.sl-sidebar-none aside[class*='col-lg-4'] { display:none !important; }
    body.sl-sidebar-none .col-lg-8 { flex:0 0 100% !important; max-width:100% !important; }`;
    } else if (sidebarPosition === 'left') {
        // .row é flex; inverter a ordem do aside o move para a esquerda
        css += `
    body.sl-sidebar-left aside[class*='col-lg-4'] { order:-1; }`;
    }
    if (footerStyle === 'simple-copyright') {
        css += `
    body.sl-footer-simple .sl-footer [class*='col-md-4'] { display:none !important; }
    body.sl-footer-simple .sl-footer .sl-footer-divider { display:none !important; }`;
    }
    if (!css) return '';
    return '\n    /* === LAYOUT (footer / sidebar escolhidos) === */' + css;
}

/**
 * Resolve a string de classes do <body> a partir de footerStyle/sidebarPosition.
 * Ex: { footerStyle:'simple-copyright', sidebarPosition:'left' }
 *     → "sl-footer-simple sl-sidebar-left"
 */
function resolverLayoutClasses({ footerStyle, sidebarPosition }) {
    const classes = [];
    if (sidebarPosition === 'none')      classes.push('sl-sidebar-none');
    else if (sidebarPosition === 'left') classes.push('sl-sidebar-left');
    if (footerStyle === 'simple-copyright')       classes.push('sl-footer-simple');
    else if (footerStyle === 'newsletter-integrated') classes.push('sl-footer-newsletter');
    return classes.join(' ');
}

/**
 * Gera a faixa de newsletter injetada no topo do footer quando
 * footerStyle === 'newsletter-integrated'. HTML estático Bootstrap 5,
 * sem tags Blogger; void elements já auto-fechados para o parser XML.
 */
function gerarFooterNewsletter() {
    return `<div class='sl-footer-newsletter-band py-4 mb-4 border-bottom border-secondary border-opacity-25'>
    <div class='container'>
      <div class='row align-items-center g-3'>
        <div class='col-lg-6'>
          <h4 class='h5 fw-bold mb-1'>Assine a nossa newsletter</h4>
          <p class='small mb-0 opacity-75'>Receba os novos conteúdos diretamente no seu e-mail.</p>
        </div>
        <div class='col-lg-6'>
          <form class='d-flex gap-2' onsubmit='return false;'>
            <input class='form-control' placeholder='O seu melhor e-mail' type='email'/>
            <button class='btn btn-primary' type='submit'>Inscrever</button>
          </form>
        </div>
      </div>
    </div>
  </div>`;
}

module.exports = {
    gerarLayoutCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
};
