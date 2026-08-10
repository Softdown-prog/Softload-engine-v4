'use strict';

// ==========================================
// COMPILER ENGINE — barrel
// ==========================================
// Motor de compilação (Chassis + DNA) quebrado em módulos menores por
// responsabilidade. Este arquivo só reexporta a API pública — mantém
// exatamente o mesmo module.exports de quando tudo vivia num único
// compilerEngine.js, para que nenhum consumidor precise mudar require().
//
//   sanitize.js        → escapes/validação de string e cor
//   xmlEntities.js     → sanitização de entidades HTML → XML (hero)
//   seo.js             → bloco de SEO (meta tags + JSON-LD)
//   fonts.js           → import de Google Fonts
//   widgets.js         → widgets XML (header, navegação, HTML genérico)
//   designTokensCss.js → CSS de cor/tipografia/badges/botão
//   layout.js          → CSS de layout (footer/sidebar) + faixa de newsletter
//   nichoImpl.js       → extrai CSS/JS/hero do impl.json de um nicho
//   nichoBlocks.js     → combina impl.json com variantes do Block Worker
//   orphans.js         → remove placeholders [[...]] não resolvidos
//   slotManifest.js    → SLOT_MANIFEST + GRID_OPTIONS (constantes declarativas)
//   fieldGraph.js      → grafo de dependências campo→slot (Layer 1)
//   compile.js         → compilarTemplate() — motor principal, injeção de DNA
// ==========================================

const { COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS } = require('../presets');
const { gerarDesignVoiceCss } = require('../designVoicePresets');

const { sanitizarInput, validarHex, sanitizarCssColor } = require('./sanitize');
const { sanitizarEntidadesXml, injetarHeroTexto } = require('./xmlEntities');
const { detectarOrfaos } = require('./orphans');
const { gerarSeoModule } = require('./seo');
const { gerarFontModule } = require('./fonts');
const { montarWidgetHtml } = require('./widgets');
const {
    gerarDynamicCss,
    gerarTypographyCss,
    gerarCategoryBadgesCss,
    gerarButtonCss,
} = require('./designTokensCss');
const {
    gerarLayoutCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
} = require('./layout');
const { carregarNichoImpl } = require('./nichoImpl');
const { carregarNichoImplComBlocos } = require('./nichoBlocks');
const { SLOT_MANIFEST, GRID_OPTIONS } = require('./slotManifest');
const { construirGrafoCampos } = require('./fieldGraph');
const { compilarTemplate } = require('./compile');
const { carregarNichoDossie } = require('./dossieLoader');
const { validarDossie } = require('./dossieValidator');
const { verificarDomIdsNoOutput } = require('./dossieIntegrityChecker');

module.exports = {
    sanitizarInput,
    validarHex,
    sanitizarCssColor,
    gerarSeoModule,
    gerarDynamicCss,
    gerarFontModule,
    gerarTypographyCss,
    gerarCategoryBadgesCss,
    gerarButtonCss,
    gerarLayoutCss,
    gerarDesignVoiceCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
    injetarHeroTexto,
    montarWidgetHtml,
    detectarOrfaos,
    compilarTemplate,
    construirGrafoCampos,
    carregarNichoImpl,
    carregarNichoImplComBlocos,
    sanitizarEntidadesXml,
    SLOT_MANIFEST,
    GRID_OPTIONS,
    COLOR_PRESETS,
    BUTTON_STYLES,
    TYPOGRAPHY_PRESETS,
    carregarNichoDossie,
    validarDossie,
    verificarDomIdsNoOutput,
};
