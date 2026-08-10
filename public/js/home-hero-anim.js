'use strict';

// ============================================================
// HOME HERO — animação de entrada (GSAP timeline) + scroll
// (ScrollTrigger). Carregado apenas em / (index.ejs), depois
// do GSAP e do ScrollTrigger via CDN.
//
// Princípios:
//   • Só propriedades aceleradas por hardware (y / opacity / scale)
//     → não força reflow, não bloqueia o thread de interação.
//   • Os CTAs nunca ficam inacessíveis: o estado inicial é "invisível
//     mas presente" (opacity 0) e a timeline revela-os logo no início.
//   • Falha graciosa: sem GSAP ou com prefers-reduced-motion, remove
//     a classe .js-anim e tudo aparece imediatamente.
// ============================================================

(function () {
    var root = document.documentElement;

    // Revela tudo instantaneamente (remove os estados iniciais do CSS).
    function revelar() { root.classList.remove('js-anim'); }

    // Avisa o script da demo do terminal (ver index.ejs) que a timeline de
    // entrada acabou — em vez de um delay fixo adivinhado, que competiria
    // por main-thread com a própria entrada se ela demorar mais que o
    // previsto (causa real do travamento no desktop: os dois animando
    // ao mesmo tempo logo após o load).
    function avisarEntradaConcluida() {
        document.dispatchEvent(new CustomEvent('sl:hero-entrance-done'));
    }

    var reduzirMovimento = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Sem GSAP (CDN falhou) ou utilizador pede menos movimento → mostra
    // estático e libera a demo imediatamente (não há animação de entrada
    // pra competir com ela nesse caminho).
    if (!window.gsap || reduzirMovimento) {
        revelar();
        avisarEntradaConcluida();
        return;
    }

    var gsap = window.gsap;
    if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

    var linhas = gsap.utils.toArray('[data-hero-line]');
    var chips  = gsap.utils.toArray('[data-hero="chips"] .chip-item');
    var painel = document.querySelector('[data-hero="panel"]');

    // ── Fixa os estados iniciais via GSAP (espelham o CSS .js-anim) e só
    //    então remove a classe — assim não há flash: o estado inline do
    //    GSAP toma o lugar do estado do CSS sem intervalo visível. ──────
    gsap.set(linhas, { yPercent: 110 });
    gsap.set('[data-hero="badge"], [data-hero="lead"], [data-hero="cta"], [data-hero="trust"]',
        { opacity: 0, y: 24 });
    gsap.set(chips, { opacity: 0, scale: 0.9 });
    if (painel) gsap.set(painel, { opacity: 0, y: 40, scale: 0.97 });

    revelar();

    // ── 1. ENTRADA (on load) ─────────────────────────────────────────────
    var tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: function () {
            iniciarFlutuacao();
            avisarEntradaConcluida();
        },
    });

    tl.to('[data-hero="badge"]', { opacity: 1, y: 0, duration: 0.5 })
      // h1: revelação linha-a-linha de baixo para cima (clip mask)
      .to(linhas, { yPercent: 0, duration: 0.9, stagger: 0.12, ease: 'power4.out' }, '-=0.25')
      .to('[data-hero="lead"]', { opacity: 1, y: 0, duration: 0.55 }, '-=0.5')
      // badges/chips: stagger + scale-up suave (0.9 → 1) guiando para o CTA
      .to(chips, { opacity: 1, scale: 1, duration: 0.45, stagger: 0.06 }, '-=0.3')
      .to('[data-hero="cta"]', { opacity: 1, y: 0, duration: 0.5 }, '-=0.3')
      .to('[data-hero="trust"]', { opacity: 1, y: 0, duration: 0.45 }, '-=0.35');

    if (painel) {
        tl.to(painel, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'power3.out' }, '-=0.85');
    }

    // ── Flutuação contínua e subtil do painel (depois da entrada) ────────
    function iniciarFlutuacao() {
        if (!painel) return;
        gsap.to(painel, {
            y: -10,
            duration: 3,
            ease: 'sine.inOut',
            repeat: -1,
            yoyo: true,
        });
    }

    // ── 2. SCROLL (ScrollTrigger) ────────────────────────────────────────
    // Cards de features entram com fade + leve subida, acompanhando o
    // scroll de forma orgânica (scrub: 1).
    if (window.ScrollTrigger) {
        gsap.utils.toArray('.feat-card').forEach(function (card) {
            gsap.from(card, {
                opacity: 0,
                y: 60,
                ease: 'none',
                scrollTrigger: {
                    trigger: card,
                    start: 'top 88%',
                    end: 'top 55%',
                    scrub: 1,
                },
            });
        });
    }
})();
