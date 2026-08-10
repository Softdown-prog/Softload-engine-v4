/**
 * Compiler Worker — Orquestrador do pipeline de compilação.
 *
 * Responsabilidades:
 *  1. Validar manifesto JSON de entrada (campos obrigatórios, tipos, valores aceitos)
 *  2. Sanitizar e normalizar todos os inputs
 *  3. Carregar o Chassis (template_base.xml)
 *  4. Chamar compilarTemplate() (motor de injeção DNA)
 *  5. Reparar XML de saída (tokens órfãos, widget IDs duplicados) — via repairEngine
 *  6. Validar estrutura básica do XML de saída (Blogger-aware)
 *  7. Retornar resultado estruturado com metadados, avisos e reparos aplicados
 *
 * Separa a lógica de negócio das rotas HTTP — facilita testes e manutenção.
 */

const path = require('path');
const fs   = require('fs');
const {
    compilarTemplate, construirGrafoCampos, sanitizarInput, validarHex,
    sanitizarEntidadesXml, montarWidgetHtml, carregarNichoDossie, verificarDomIdsNoOutput,
} = require('./compilerEngine');
const { ENUMS }       = require('../ai/blueprintSchema');
const { repararXml }  = require('./repairEngine');
const { NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT } = require('./designVoicePresets');
const { chassisParaNicho, pageTypeParaNicho } = require('./nichoTaxonomy');
const { modulosPadraoDoNicho } = require('./nichoModuleDefaults');
const { gerarDiagnostico } = require('./diagnostico');
const { registrarCompilacao } = require('./telemetria');
const { hashSeed } = require('./blockLibrary');

// Fonte de verdade dos valores de mobileMenuType — ver MOBILE_MENU_VARIANTES
// em modules.js (mesmas 5 chaves, checadas ali por lookup em objeto).
const MENU_VALIDOS     = ['classico', 'offcanvas', 'offcanvas-right', 'hamburger-svg', 'hamburger-icons'];
const COMMENTS_VALIDOS = ['nativo', 'disqus'];

// Mapeamento rápido de campo → default seguro para enums do novo pipeline
// gridLayout e sidebarPosition NÃO entram aqui de propósito — os defaults
// variam por seed (siteName+nicho) em vez de um valor fixo (ver
// achado "sempre o mesmo layout sem personalidade" — sidebarPosition
// era hardcoded 'right' pra todo site, gridLayout preso ao único valor
// de nichoDefaults mesmo quando o próprio nicho tolera 2 opções, ver
// PAGINA_TIPO_GRID_ALTERNATIVAS abaixo).
const ENUM_DEFAULTS_WORKER = {
    colorPreset:     'tech-blue',
    typography:      'inter',
    buttonStyle:     'default',
    footerStyle:     'advanced-3-cols',
    designVoice:     'auto',
};

// Mesmo dado de PAGE_TYPE_GRID_PREFERIDO em blueprintCritics.js (fonte
// original, usada lá só como crítica/aviso do fluxo de chat) — duplicado
// aqui de propósito: os dois arquivos resolvem o mesmo campo em fluxos
// diferentes (chat vs manifesto direto) e blueprintCritics.js já é
// carregado só no fluxo de chat, criar dependência cruzada não compensa
// pra 4 linhas de dado. pageTypes fora deste mapa mantêm o gridLayout
// único de nichoModuleDefaults.js (escolha deliberada, sem alternativa
// documentada como igualmente válida).
const PAGINA_TIPO_GRID_ALTERNATIVAS = {
    'portal-noticias':   ['mural', 'revista'],
    'magazine':          ['revista', 'mural'],
    'documentacao':      ['lista', 'dupla'],
    'catalogo-produtos': ['quadrado', 'mural'],
};

// Escolhe determinística e uniformemente entre 2 valores a partir de um
// seed — mesmo princípio de _escolherPorSeed em modules.js (dark mode,
// back-to-top, paginação): nunca Math.random(), mesmo site sempre cai no
// mesmo valor entre recompilações, sites diferentes tendem a variar.
function _escolherEntre2PorSeed(seed, papel, opcoes) {
    return opcoes[hashSeed(`${seed || ''}:${papel}`) % opcoes.length];
}

// ==========================================
// PASSO 1: VALIDAÇÃO DO MANIFESTO JSON
// ==========================================

function validarManifesto(body) {
    const erros = [];

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        erros.push('Corpo da requisição não é um objeto JSON válido.');
        return erros;
    }

    const { siteName, modules } = body;

    if (!siteName || typeof siteName !== 'string' || siteName.trim().length < 2) {
        erros.push('siteName: obrigatório, mínimo 2 caracteres.');
    }

    if (modules !== undefined && (typeof modules !== 'object' || Array.isArray(modules))) {
        erros.push('modules: deve ser um objeto (ex: { darkMode: true, backToTop: false }).');
    }

    return erros;
}

// ==========================================
// PASSO 2: NORMALIZAÇÃO E SANITIZAÇÃO
// ==========================================

// Valida um campo enum usando ENUMS do blueprintSchema como fonte de verdade.
// Se o valor não for válido, retorna o default seguro.
function resolverEnum(valor, campo, fallback) {
    const validos = ENUMS[campo];
    if (validos && validos.includes(valor)) return valor;
    return ENUM_DEFAULTS_WORKER[campo] ?? fallback;
}

// Resolve 'auto' para a voz de design inferida de nichoTema e colorPreset.
// Valor explícito válido é retornado diretamente; valor inválido → '' (sem voice CSS).
function _resolverDesignVoice(designVoice, nichoTema, colorPreset) {
    const nichoNorm = typeof nichoTema === 'string' ? nichoTema.replace(/^tema-/, '').toLowerCase() : '';
    const raw = typeof designVoice === 'string' ? designVoice.trim() : 'auto';
    const validos = ENUMS.designVoice || [];

    if (raw && raw !== 'auto' && validos.includes(raw)) return raw;

    // Inferência: nicho primeiro, colorPreset como desempate
    return NICHO_DESIGN_VOICE_MAP[nichoNorm]
        || COLOR_DESIGN_VOICE_HINT[colorPreset]
        || '';
}

function normalizarManifesto(body) {
    // enableSeo: liga por padrão (meta description, canonical, robots, JSON-LD
    // WebSite — ver gerarSeoModule) — só desliga com opt-out explícito.
    // Antes nascia 'false' e o fluxo rápido do Workspace nunca enviava esse
    // campo, então nenhum template gerado por ali tinha essas tags: mesmo
    // padrão do gap de módulos (dark mode, reading time) corrigido nas PRs
    // #432/#433, mas pro SEO — que não tem motivo pra ser opt-in.
    const seoAtivo      = !(body.enableSeo === false || body.enableSeo === 'false');
    const lazyLoadAtivo = Boolean(body.lazyLoad   === 'true' || body.lazyLoad   === true || body.lazyLoad);

    // nichoTema: valida contra as 14 chaves de NICHO_CHASSIS_MAP (nichoTaxonomy.js).
    // Aceita "gamer-playerone" ou "tema-gamer-playerone" (normalizado abaixo).
    // Valor inválido → null (template base neutro, sem CSS de nicho).
    // Resolvido ANTES de modulosAtivos porque os defaults de módulo dependem do nicho.
    const nichoTemaRaw = typeof body.nichoTema === 'string' ? body.nichoTema.trim() : '';
    const nichoTemaNorm = nichoTemaRaw.replace(/^tema-/, '').toLowerCase();
    const nichoTema = chassisParaNicho(nichoTemaNorm)
        ? nichoTemaNorm
        : (nichoTemaRaw ? (console.warn(`[COMPILER-WORKER] nichoTema inválido ignorado: "${nichoTemaRaw}"`), null) : null);

    // Defaults de módulos por nicho (dark mode, reading time, dropcap, etc.)
    // — mesma fonte usada pelo fluxo de chat/IA (nichoModuleDefaults.js).
    // body.modules, quando enviado explicitamente, sempre vence o default;
    // campo ausente cai no default do nicho (que pode ser 'desligado').
    const nichoDefaults = modulosPadraoDoNicho(nichoTema);
    const m = body.modules && typeof body.modules === 'object' ? body.modules : {};
    const comDefault = (campo) => m[campo] !== undefined ? Boolean(m[campo]) : Boolean(nichoDefaults[campo]);

    const modulosAtivos = {
        darkMode:        comDefault('darkMode'),
        backToTop:       comDefault('backToTop'),
        cookieBanner:    comDefault('cookieBanner'),
        toc:             comDefault('toc'),
        error404:        comDefault('error404'),
        error404Theme:   ['gamer', 'appstore', 'natureza', 'techwind', 'magnews'].includes(m.error404Theme) ? m.error404Theme : (nichoDefaults.error404Theme || ''),
        slotBefore:      Boolean(m.slotBefore),
        slotAfter:       Boolean(m.slotAfter),
        shareButtons:    comDefault('shareButtons'),
        readingProgress: comDefault('readingProgress'),
        readingTime:     comDefault('readingTime'),
        dropcap:         comDefault('dropcap'),
        reviewEngine:    comDefault('reviewEngine'),
        sliderJson:      comDefault('sliderJson'),
        relatedPosts:    comDefault('relatedPosts'),
        contactForm:     comDefault('contactForm'),
        contactFormTitle: typeof m.contactFormTitle === 'string' && m.contactFormTitle.trim()
            ? m.contactFormTitle.trim().substring(0, 60)
            : (nichoDefaults.contactFormTitle || ''),
        popularPostsRanking: comDefault('popularPostsRanking'),
        popularPostsRankingTitle: typeof m.popularPostsRankingTitle === 'string' && m.popularPostsRankingTitle.trim()
            ? m.popularPostsRankingTitle.trim().substring(0, 60)
            : (nichoDefaults.popularPostsRankingTitle || ''),
        appDownloadCta:  comDefault('appDownloadCta'),
        menuDropdownPrefixo: comDefault('menuDropdownPrefixo'),
        // "Mobília" nativa (sidebar/rodapé) — ver nichoModuleDefaults.js
        // pra que pageType liga cada uma por padrão.
        statsWidget:     comDefault('statsWidget'),
        statsWidgetTitle: typeof m.statsWidgetTitle === 'string' && m.statsWidgetTitle.trim()
            ? m.statsWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.statsWidgetTitle || ''),
        blogArchiveWidget: comDefault('blogArchiveWidget'),
        blogArchiveWidgetTitle: typeof m.blogArchiveWidgetTitle === 'string' && m.blogArchiveWidgetTitle.trim()
            ? m.blogArchiveWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.blogArchiveWidgetTitle || ''),
        translateWidget: comDefault('translateWidget'),
        featuredPostWidget: comDefault('featuredPostWidget'),
        featuredPostWidgetTitle: typeof m.featuredPostWidgetTitle === 'string' && m.featuredPostWidgetTitle.trim()
            ? m.featuredPostWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.featuredPostWidgetTitle || ''),
        labelCloudWidget: comDefault('labelCloudWidget'),
        labelCloudWidgetTitle: typeof m.labelCloudWidgetTitle === 'string' && m.labelCloudWidgetTitle.trim()
            ? m.labelCloudWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.labelCloudWidgetTitle || ''),
        socialLinksWidget: comDefault('socialLinksWidget'),
        socialLinksWidgetTitle: typeof m.socialLinksWidgetTitle === 'string' && m.socialLinksWidgetTitle.trim()
            ? m.socialLinksWidgetTitle.trim().substring(0, 60)
            : (nichoDefaults.socialLinksWidgetTitle || ''),
        mobileMenuType:  MENU_VALIDOS.includes(m.mobileMenuType)     ? m.mobileMenuType  : (nichoDefaults.menuType || ''),
        commentsSystem:  COMMENTS_VALIDOS.includes(m.commentsSystem) ? m.commentsSystem  : '',
    };

    // Suporta: array de strings ['FPS','RPG'], array [{nome, bg, text}] ou objeto {nome: {bg, text}}
    let badgesProcessados = [];
    if (body.categoryBadges) {
        const rawBadges = Array.isArray(body.categoryBadges)
            ? body.categoryBadges.map(b => (typeof b === 'string' ? { nome: b } : b))
            : Object.entries(body.categoryBadges).map(([nome, cores]) => ({ nome, ...cores }));

        badgesProcessados = rawBadges
            .filter(b => b && b.nome)
            .slice(0, 8)  // max 8 badges — mesmo limite usado no schema do blueprint
            .map(b => ({
                nome: sanitizarInput(String(b.nome).substring(0, 40)),
                bg:   validarHex(b.bg)   ? b.bg   : '#3498db',
                text: validarHex(b.text) ? b.text : '#ffffff',
            }));
    }

    // siteName: truncar a 60 chars — mesmo limite usado no schema do blueprint
    const siteNameBruto = String(body.siteName).trim().substring(0, 60);

    const slug = siteNameBruto.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 40) || 'template';

    // seed de layout: mesmo princípio de iconSeed em compile.js (siteName+
    // nicho), mas namespace próprio — layout estrutural (grid/sidebar) não
    // deve ficar correlacionado com a escolha de ícone/dark-mode do mesmo site.
    const seedLayout   = siteNameBruto + (nichoTema || '');
    const pageTypeAtual = pageTypeParaNicho(nichoTema);
    // gridLayout: nichos cujo pageType tolera 2 layouts igualmente válidos
    // (ver PAGINA_TIPO_GRID_ALTERNATIVAS) variam por seed — antes ficavam
    // presos ao único valor de nichoDefaults.gridLayout em todo site do
    // nicho, mesmo quando um segundo valor já era documentado como
    // igualmente aceitável (achado "sempre o mesmo layout sem personalidade").
    const gridAlternativas = PAGINA_TIPO_GRID_ALTERNATIVAS[pageTypeAtual];
    const gridLayoutDefault = gridAlternativas
        ? _escolherEntre2PorSeed(seedLayout, 'gridlayout', gridAlternativas)
        : (nichoDefaults.gridLayout || 'revista');
    // sidebarPosition: antes hardcoded 'right' pra todo site do Engine,
    // sem exceção — agora varia entre 'right'/'left' por seed quando o
    // chamador não escolhe explicitamente. 'none' nunca entra aqui (só é
    // atingido por escolha explícita do usuário/IA, nunca por sorteio —
    // remover a sidebar por completo é decisão grande demais pra deixar
    // no acaso do seed).
    const sidebarPositionDefault = _escolherEntre2PorSeed(seedLayout, 'sidebar', ['right', 'left']);

    return {
        siteName:           siteNameBruto,
        siteNameSanitizado: sanitizarInput(siteNameBruto),
        // description: descrição real do site/negócio, capturada na conversa
        // do chat (ver _blueprintParaManifesto em chatTemplateCompiler.js).
        // Achado real: esse campo já era persistido no manifesto (Firestore/
        // GCS) desde a Fix 2 da auditoria "chat não usa o que o usuário
        // pediu", mas nunca chegava no XML compilado — normalizarManifesto
        // simplesmente não repassava o campo pra frente. Usado em
        // gerarSeoModule() como <meta name='description'> real, no lugar de
        // repetir o siteName.
        description: typeof body.description === 'string' && body.description.trim()
            ? body.description.trim().substring(0, 240)
            : null,
        seoAtivo,
        lazyLoadAtivo,
        modulosAtivos,
        badgesProcessados,
        slug,
        nichoTema,
        // pageType: eixo estrutural (blog/landing/portal/...) — deriva do nicho
        // via nichoTaxonomy.js, mesma fonte usada pelo fluxo de chat/IA.
        // Hoje só informativo (chassis ainda vem de nichoTema); ver nichoTaxonomy.js.
        pageType: pageTypeAtual,
        // Validados contra ENUMS do blueprintSchema — valor fora do enum → default seguro
        colorPreset: resolverEnum(body.colorPreset, 'colorPreset', 'tech-blue'),
        typography:  resolverEnum(body.typography,  'typography',  'inter'),
        // Fallback: valor explícito do body → gridLayoutDefault (seed entre
        // as 2 opções do pageType quando existem, senão o único valor de
        // nichoDefaults — ver PAGINA_TIPO_GRID_ALTERNATIVAS acima).
        gridLayout:  resolverEnum(body.gridLayout,  'gridLayout',  gridLayoutDefault),
        // buttonStyle não está nos ENUMS do blueprintSchema (exclusivo do chassis pipeline)
        buttonStyle: typeof body.buttonStyle === 'string' ? body.buttonStyle : 'default',
        // footerStyle: validado contra ENUMS → default seguro.
        // sidebarPosition: valor explícito do body → sidebarPositionDefault
        // (seed entre 'right'/'left' — ver acima).
        footerStyle:     resolverEnum(body.footerStyle,     'footerStyle',     'advanced-3-cols'),
        sidebarPosition: resolverEnum(body.sidebarPosition, 'sidebarPosition', sidebarPositionDefault),
        // heroTitle / heroSubtitle: texto livre opcional (null = usa o do hero gerado)
        heroTitle:    typeof body.heroTitle    === 'string' && body.heroTitle.trim()    ? body.heroTitle.trim().substring(0, 120) : null,
        heroSubtitle: typeof body.heroSubtitle === 'string' && body.heroSubtitle.trim() ? body.heroSubtitle.trim().substring(0, 200) : null,
        // designVoice: 'auto' → inferido de nichoTema e colorPreset; valor explícito validado contra ENUMS
        designVoice: _resolverDesignVoice(body.designVoice, body.nichoTema, body.colorPreset),
    };
}

// ==========================================
// PASSO 3: CARREGAR CHASSIS
// ==========================================

// nichoTema → chassis vem de nichoTaxonomy.js — fonte única de verdade
// compartilhada com blueprintCritics.js (fluxo de chat/IA), pra evitar as
// duas tabelas divergirem em silêncio como acontecia antes (ver histórico
// do módulo: tecnologia-techwind tinha pageType e chassis incoerentes).
function templateParaNicho(nichoTema) {
    if (!nichoTema) return 'base';
    const chave = String(nichoTema).replace(/^tema-/, '').toLowerCase().trim();
    return chassisParaNicho(chave) || 'base';
}

// Substitui [[BLOGGER_INCLUDABLES_PADRAO]] pelo bloco compartilhado de
// includables padrão do Blogger (ver src/rag/templates/_partials/
// blogger-includables-padrao.xml — mesmo conteúdo hoje escrito por extenso,
// idêntico modulo espaço em branco, nos 5 chassis de família). Os 5 chassis
// de família não usam o token (histórico, escrito antes de existir) —
// no-op idempotente pra eles. Só esqueletos por-nicho novos
// (template_<nicho>.xml, ver plano "esqueleto por nicho") usam o token,
// evitando duplicar as mesmas ~240 linhas em cada arquivo novo.
let _includablesPadraoCache = null;
function _resolverIncludablesPadrao(conteudo) {
    if (!conteudo.includes('[[BLOGGER_INCLUDABLES_PADRAO]]')) return conteudo;
    if (_includablesPadraoCache === null) {
        const partialPath = path.join(__dirname, '../rag/templates/_partials/blogger-includables-padrao.xml');
        _includablesPadraoCache = fs.readFileSync(partialPath, 'utf-8');
    }
    return conteudo.split('[[BLOGGER_INCLUDABLES_PADRAO]]').join(_includablesPadraoCache);
}

function carregarChassis(templateTipo = 'base') {
    const nomeArquivo = templateTipo === 'base'
        ? 'template_base.xml'
        : `template_${templateTipo}.xml`;
    const templatePath = path.join(__dirname, '../rag/templates', nomeArquivo);
    let conteudo;
    try {
        conteudo = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
        // fallback para base se o template específico não existir
        if (templateTipo !== 'base') {
            console.warn(`[CHASSIS] template_${templateTipo}.xml não encontrado, usando base.`);
            return carregarChassis('base');
        }
        throw new Error(`[CHASSIS] Falha ao ler template_base.xml: ${err.message}`);
    }
    if (!conteudo || conteudo.length < 200) {
        throw new Error(`[CHASSIS] ${nomeArquivo} está vazio ou corrompido.`);
    }
    return _resolverIncludablesPadrao(conteudo);
}

// Resolução nicho-primeiro-depois-família (ver plano "esqueleto por
// nicho" — /root/.claude/plans/indexed-jumping-treehouse.md): tenta
// template_<nichoTema>.xml (esqueleto próprio, com a estrutura física real
// extraída de exemplos/<nicho>.xml) ANTES do chassis de família
// (template_<chassisFamília>.xml, resolvido por templateParaNicho()).
// Nicho ainda sem esqueleto próprio — hoje a maioria — cai exatamente no
// comportamento de sempre: migração incremental, sem big-bang, zero risco
// pros nichos que esta migração ainda não tocou.
function carregarChassisParaNicho(nichoTema) {
    const chave = nichoTema ? String(nichoTema).replace(/^tema-/, '').toLowerCase().trim() : '';
    if (chave) {
        const caminhoProprio = path.join(__dirname, '../rag/templates', `template_${chave}.xml`);
        if (fs.existsSync(caminhoProprio)) {
            return carregarChassis(chave);
        }
    }
    return carregarChassis(templateParaNicho(nichoTema));
}

// ==========================================
// PASSO 4c: INJEÇÃO DE DESIGN PACKAGE
// ==========================================

/**
 * Injeta campos opcionais do Design Package no XML compilado.
 * Todos os campos são opcionais — XML sem package é devolvido inalterado.
 *
 * Campos suportados em body:
 *   darkTheme      {boolean} — script anti-flash data-bs-theme="dark" antes de </head>
 *   customCss      {string}  — CSS adicional no final do bloco <b:skin> CDATA
 *   svgLogo        {string}  — SVG inline após o primeiro > de .navbar-brand
 *   heroHtml       {string}  — HTML completo do hero antes do <b:section class='main'
 *   staticSections {string}  — Seções estáticas (features, pricing...) após o hero
 */
function injetarDesignPackage(xml, body) {
    const injecoes = [];

    // 1. darkTheme → script anti-flash antes de </head>
    if (body.darkTheme === true || body.darkTheme === 'true') {
        const scriptDark = [
            "<script>",
            "  //<![CDATA[",
            "  document.documentElement.setAttribute('data-bs-theme','dark');",
            "  //]]>",
            "</script>",
        ].join('\n');
        if (xml.includes('</head>')) {
            xml = xml.replace('</head>', scriptDark + '\n</head>');
            injecoes.push('darkTheme');
        }
    }

    // 2. customCss → DENTRO do CDATA do <b:skin>, antes do ]]>
    //    Substituir </b:skin> injetaria FORA do CDATA → & nu causa SAX error.
    //    Marcadores DP:CSS:START/END permitem extração exata pelo templateExtractor
    if (typeof body.customCss === 'string' && body.customCss.trim()) {
        const cdataSkinEnd = ']]></b:skin>';
        if (xml.includes(cdataSkinEnd)) {
            const css = '\n<!-- DP:CSS:START -->\n' + body.customCss.trim() + '\n<!-- DP:CSS:END -->\n';
            xml = xml.replace(cdataSkinEnd, css + cdataSkinEnd);
            injecoes.push('customCss');
        } else if (xml.includes('</b:skin>')) {
            // fallback: skin sem CDATA — escapa & para segurança no XML
            const css = '\n<!-- DP:CSS:START -->\n' + sanitizarEntidadesXml(body.customCss.trim()) + '\n<!-- DP:CSS:END -->\n';
            xml = xml.replace('</b:skin>', css + '</b:skin>');
            injecoes.push('customCss');
        }
    }

    // 3. svgLogo → antes de <b:section id='header-logo' (presente em todos os templates)
    //    Injetado no corpo XML (fora de CDATA) → & deve ser &amp;
    //    Marcadores DP:LOGO:START/END permitem extração exata pelo templateExtractor
    if (typeof body.svgLogo === 'string' && body.svgLogo.trim()) {
        const svgHtml = '\n        <!-- DP:LOGO:START -->\n        ' + sanitizarEntidadesXml(body.svgLogo.trim()) + '\n        <!-- DP:LOGO:END -->\n        ';
        const headerLogoMarker = "<b:section id='header-logo'";
        const brandMarkers = [
            "class='saas-nav-brand",
            "class='sl-header-brand",
            "class='mag-nav-brand",
            "class='portfolio-brand",
            "class='navbar-brand",
        ];
        let svgInjetado = false;
        if (xml.includes(headerLogoMarker)) {
            xml = xml.replace(headerLogoMarker, svgHtml + headerLogoMarker);
            injecoes.push('svgLogo');
            svgInjetado = true;
        } else {
            for (const marker of brandMarkers) {
                if (xml.includes(marker)) {
                    const idx = xml.indexOf(marker);
                    const gt  = xml.indexOf('>', idx);
                    if (gt !== -1) {
                        xml = xml.slice(0, gt + 1) + svgHtml + xml.slice(gt + 1);
                        injecoes.push('svgLogo');
                        svgInjetado = true;
                    }
                    break;
                }
            }
        }
        if (!svgInjetado) {
            console.warn('[COMPILER-WORKER] svgLogo: nenhum marcador de brand encontrado no template.');
        }
    }

    // 4. heroHtml + staticSections → widgets HTML numa b:section própria, antes
    //    do <b:section id='main' (marcador canônico). Embrulhar em widgets torna
    //    o hero e as seções da landing editáveis/removíveis pelo painel de Layout
    //    do Blogger (estilo WordPress) — antes eram HTML fixo, invisível ao Layout.
    //    Marcadores DP:HERO:*/DP:SECTIONS:* permitem extração exata pelo templateExtractor
    const mainMarker = "<b:section id='main'";
    if (xml.includes(mainMarker)) {
        let inject = '';
        if (typeof body.heroHtml === 'string' && body.heroHtml.trim()) {
            inject += "\n<!-- DP:HERO:START -->\n<b:section id='landing-hero' name='Landing — Hero' showaddelement='yes'>"
                + montarWidgetHtml('HTML90', 'Hero da Landing', body.heroHtml)
                + '</b:section>\n<!-- DP:HERO:END -->';
            injecoes.push('heroHtml');
        }
        if (typeof body.staticSections === 'string' && body.staticSections.trim()) {
            inject += "\n<!-- DP:SECTIONS:START -->\n<b:section id='landing-sections' name='Landing — Seções' showaddelement='yes'>"
                + montarWidgetHtml('HTML91', 'Seções da Landing', body.staticSections)
                + '</b:section>\n<!-- DP:SECTIONS:END -->';
            injecoes.push('staticSections');
        }
        if (inject) {
            // Gated por isMultipleItems: hero/seções de landing são conteúdo de
            // home/listagem. Sem esse b:if, renderizavam em TODA página (inclusive
            // posts individuais) — o <h1> quase sempre presente no heroHtml colidia
            // com o <h1> do título do post (achado real do diagnostico-sweep: 14
            // itens com H1 duplicado, todos com heroHtml/staticSections de design
            // package). Os marcadores DP:*:START/END ficam DENTRO do b:if — o
            // templateExtractor só procura entre eles, o wrapper externo não afeta
            // a extração ao reeditar o pacote.
            xml = xml.replace(mainMarker, "<b:if cond='data:view.isMultipleItems'>" + inject + "\n</b:if>\n    " + mainMarker);
        }
    }

    return { xml, injecoes };
}

// injetarDesignPackage() (acima) depende de 4 strings literais fixas no
// esqueleto — SEM rede de segurança própria (diferente do sistema de
// [[TOKEN]] de compile.js, que tem detectarOrfaos()): se a string não
// existir, a injeção correspondente falha em silêncio. Todo esqueleto
// novo por-nicho (template_<nicho>.xml, ver plano "esqueleto por nicho")
// precisa preservar essas 4 strings verbatim, senão o Design Package do
// chat de edição do Workspace para de funcionar pro nicho, sem erro
// nenhum. Não faz parte do pipeline de compilação — é chamado
// manualmente na verificação pós-extração de cada nicho migrado
// (metodologia do plano, passo 6).
function verificarMarcadoresDesignPackage(xmlEsqueleto) {
    const erros = [];
    if (!xmlEsqueleto.includes('</head>')) {
        erros.push('darkTheme: marcador "</head>" ausente.');
    }
    if (!xmlEsqueleto.includes(']]></b:skin>') && !xmlEsqueleto.includes('</b:skin>')) {
        erros.push('customCss: nem "]]></b:skin>" (CDATA) nem "</b:skin>" (fallback) presentes.');
    }
    const brandMarkers = [
        "class='saas-nav-brand", "class='sl-header-brand", "class='mag-nav-brand",
        "class='portfolio-brand", "class='navbar-brand",
    ];
    if (!xmlEsqueleto.includes("<b:section id='header-logo'") && !brandMarkers.some(m => xmlEsqueleto.includes(m))) {
        erros.push('svgLogo: nem "header-logo" nem nenhuma classe de marca conhecida presentes.');
    }
    if (!xmlEsqueleto.includes("<b:section id='main'")) {
        erros.push('heroHtml/staticSections: marcador canônico "<b:section id=\'main\'" ausente.');
    }
    return { ok: erros.length === 0, erros };
}

// ==========================================
// PASSO 5: VALIDAÇÃO DO XML DE SAÍDA
// ==========================================

function validarXmlSaida(xml) {
    const avisos = [];

    if (!xml.includes('<html') || !xml.includes('</html>')) {
        avisos.push('Estrutura <html> ausente no XML de saída.');
    }
    if (!xml.includes('<head') || !xml.includes('</head>')) {
        avisos.push('Estrutura <head> ausente no XML de saída.');
    }
    if (!xml.includes('<body') || !xml.includes('</body>')) {
        avisos.push('Estrutura <body> ausente no XML de saída.');
    }
    if (!xml.includes('<b:skin>') && !xml.includes("<b:skin ")) {
        avisos.push('Tag <b:skin> ausente — CSS não será aplicado pelo Blogger.');
    }
    if (!xml.includes('bootstrap@5') && !xml.includes('bootstrap.min.css')) {
        avisos.push('Bootstrap CDN não encontrado no <head> — layout depende do Bootstrap.');
    }

    // Tokens residuais após repararXml indicam problema no engine
    const orfaos = xml.match(/\[\[[A-Z0-9_]+\]\]/g);
    if (orfaos) {
        avisos.push(`Placeholders residuais detectados: ${[...new Set(orfaos)].join(', ')}`);
    }

    // & nu fora de CDATA → causa SAXParseException no Blogger/Java
    // Remove blocos CDATA antes de checar para não gerar falso positivo
    const xmlForaCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const ampNus = xmlForaCdata.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g);
    if (ampNus) {
        avisos.push(`SAXParseException potencial: ${ampNus.length} '&' não-escapado(s) fora de CDATA. Use &amp; em heroHtml/svgLogo/staticSections.`);
    }

    return avisos;
}

// ==========================================
// WORKER PRINCIPAL
// ==========================================

/**
 * Executa o pipeline completo de compilação.
 * Lança Error com prefixo de etapa em caso de falha.
 * Retorna resultado estruturado em caso de sucesso.
 */
function executarCompilacao(body) {
    // Passo 1 — Validar manifesto
    const errosManifesto = validarManifesto(body);
    if (errosManifesto.length > 0) {
        throw new Error(`[MANIFEST] ${errosManifesto.join(' | ')}`);
    }

    // Passo 2 — Normalizar inputs (enums validados contra blueprintSchema.ENUMS)
    const params = normalizarManifesto(body);

    // Passo 3 — Carregar chassis (esqueleto próprio do nicho se existir,
    // senão chassis de família — ver carregarChassisParaNicho())
    const templateBase = carregarChassisParaNicho(params.nichoTema);

    // Dossiê do nicho (null se ainda não migrado) — carregado aqui (antes do
    // compile) pra decidir a supressão de hero abaixo, e reaproveitado no
    // Passo 5b pra verificação de integridade (mesmo dossieLoader com cache
    // em memória — uma única leitura de fato).
    const dossieDoNicho = carregarNichoDossie(params.nichoTema);

    // Passo 4 — Compilar (injetar DNA)
    let xmlBruto, trace;
    // temHeroDesignPackage suprime o slot NICHO_HERO quando o manifesto já
    // tem um heroHtml próprio (design package), evitando 2 heroes na mesma
    // home. Mas essa checagem não sabia nada sobre dossiê: se o nicho
    // migrado declara um hero PROTEGIDO (protegida:true — nunca deve ser
    // trocado/suprimido, ver montarNichoDeDossie), suprimir o slot mesmo
    // assim descarta o HTML que o próprio dossiê already resolveu pra usar
    // — e como o CSS/JS da peça continuam entrando no blob geral, o
    // resultado é JS/CSS órfão (domId declarado que nunca aparece no XML),
    // pego só depois pelo checker de integridade do Passo 5b (achado real:
    // viral-magazine + design package "febre-viral" coexistindo, hero-grid
    // protegido sendo descartado). Hoisted pra fora do try — também usado
    // no Passo 4c pra suprimir heroHtml do Design Package (ver ali).
    const heroProtegidoNoDossie = !!(dossieDoNicho && dossieDoNicho.pecas.some(
        p => p.tipo === 'hero' && p.protegida
    ));
    try {
        ({ xml: xmlBruto, trace } = compilarTemplate(templateBase, {
            siteName:       params.siteName,
            description:    params.description,
            enableSeo:      params.seoAtivo,
            gridLayout:     params.gridLayout,
            colorPreset:    params.colorPreset,
            buttonStyle:    params.buttonStyle,
            typography:     params.typography,
            modules:        params.modulosAtivos,
            categoryBadges: params.badgesProcessados,
            lazyLoad:       params.lazyLoadAtivo,
            nichoTema:      params.nichoTema,
            footerStyle:     params.footerStyle,
            sidebarPosition: params.sidebarPosition,
            heroTitle:       params.heroTitle,
            heroSubtitle:    params.heroSubtitle,
            designVoice:     params.designVoice,
            temHeroDesignPackage: heroProtegidoNoDossie
                ? false
                : Boolean(typeof body.heroHtml === 'string' && body.heroHtml.trim()),
        }));
    } catch (err) {
        throw new Error(`[ENGINE] Falha na compilação: ${err.message}`);
    }

    // Passo 4b — Grafo de dependências (Layer 1: campo → slot)
    const grafo = construirGrafoCampos(trace);
    const slotsAtivos = trace.filter(n => n.active).length;
    const camposInfluentes = [...grafo.campoParaSlots.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([campo, slots]) => ({ campo, qtdSlots: slots.length, slots }));

    console.log(
        `[COMPILER-WORKER] Grafo: ${trace.length} slots | ${slotsAtivos} ativos | ` +
        `campo mais influente: ${camposInfluentes[0]?.campo ?? '-'} (${camposInfluentes[0]?.qtdSlots ?? 0} slots)`
    );

    // Passo 4c — Injetar Design Package (campos opcionais retrocompatíveis)
    // heroHtml é excluído aqui quando o dossiê já tem um hero PROTEGIDO
    // (heroProtegidoNoDossie, calculado no Passo 4): sem isso, o hero real
    // do dossiê (renderizado em NICHO_HERO por causa do mesmo
    // heroProtegidoNoDossie) e o hero genérico do blueprintEnricher (que
    // SEMPRE preenche body.heroHtml quando ausente) apareciam juntos na
    // home — achado real: 2 heroes / 3 <h1> em todo template gerado,
    // porque este passo não sabia sobre heroProtegidoNoDossie.
    // staticSections continua normal — não é hero, é conteúdo extra de
    // landing page, sem conflito com o hero do dossiê.
    const bodyParaDesignPackage = heroProtegidoNoDossie ? { ...body, heroHtml: undefined } : body;
    const DESIGN_PACKAGE_CAMPOS = ['customCss', 'svgLogo', 'heroHtml', 'staticSections', 'darkTheme'];
    const temDesignPackage = DESIGN_PACKAGE_CAMPOS.some(c => bodyParaDesignPackage[c] !== undefined && bodyParaDesignPackage[c] !== null && bodyParaDesignPackage[c] !== '');
    let xmlParaReparar = xmlBruto;
    let injecoesPackage = [];
    if (temDesignPackage) {
        ({ xml: xmlParaReparar, injecoes: injecoesPackage } = injetarDesignPackage(xmlBruto, bodyParaDesignPackage));
        if (injecoesPackage.length > 0) {
            console.log(`[COMPILER-WORKER] Design Package injetado: ${injecoesPackage.join(', ')}`);
        }
    }

    // Passo 5 — Reparar XML (tokens órfãos + widget IDs duplicados + & bare em atributos)
    // repararXml() é idempotente: XML limpo é devolvido inalterado.
    // Roda sobre o XML já com Design Package para cobrir também o conteúdo injetado.
    const { xml: xmlFinal, reparos: reparosXml } = repararXml(xmlParaReparar);
    if (reparosXml.length > 0) {
        console.warn('[COMPILER-WORKER] XML reparado:', reparosXml.map(r => r.acção || r.detalhes).join(' | '));
    }

    // Passo 5b — Verificar integridade do dossiê (só nichos migrados)
    // Diferente do safety-net do Diagnóstico (Passo 7, nunca bloqueia): isto
    // é contrato declarado pelo próprio nicho (domIds), não heurística —
    // mesma seriedade que validarXmlEstrutura/validarSemanticaBlogger têm
    // no Stage 3 VERIFY do pipeline. Nichos sem dossiê (carregarNichoDossie
    // retorna null) não são afetados — raio de explosão contido ao nicho migrado.
    // (dossieDoNicho já carregado no Passo 4, reaproveitado aqui.)
    if (dossieDoNicho) {
        const { ok, erros: errosIntegridade } = verificarDomIdsNoOutput(xmlFinal, dossieDoNicho);
        if (!ok) {
            throw new Error(`[DOSSIE] Integridade do nicho "${params.nichoTema}" violada: ${errosIntegridade.join(' | ')}`);
        }
    }

    // Passo 6 — Validar saída
    const avisos = validarXmlSaida(xmlFinal);
    if (avisos.length > 0) {
        console.warn('[COMPILER-WORKER] ⚠️ Avisos na validação do XML de saída:', avisos.join(' | '));
    }

    // Passo 7 — Safety-net do Diagnóstico Inteligente: roda uma vez, só pra
    // visibilidade. Não é loop nem correção automática — repararXml() do
    // Passo 5 já é o mecanismo determinístico de correção, e a maior parte
    // do que o Diagnóstico encontra é estrutural (chassis/nicho), corrigido
    // na fonte, não em runtime (ver scripts/diagnostico-sweep.js). Isto só
    // garante que um erro real que escape das duas camadas anteriores não
    // saia em silêncio — nunca lança, nunca bloqueia a compilação.
    let diagnosticoErros = null;
    try {
        const diagSeguranca = gerarDiagnostico(xmlFinal);
        diagnosticoErros = diagSeguranca.totalErros;
        if (diagSeguranca.totalErros > 0) {
            const errosPorCategoria = diagSeguranca.categorias
                .filter(c => c.achados.some(a => a.nivel === 'erro'))
                .map(c => `${c.nome}: ${c.achados.filter(a => a.nivel === 'erro').map(a => a.mensagem).join(' | ')}`);
            console.error(`[COMPILER-WORKER] 🩺 Diagnóstico encontrou ${diagSeguranca.totalErros} erro(s) real(is) no XML compilado (nicho: ${params.nichoTema || 'nenhum'}):`, errosPorCategoria.join(' || '));
        }
    } catch (err) {
        console.warn('[COMPILER-WORKER] Safety-net do Diagnóstico falhou ao rodar (ignorado):', err.message);
    }

    // Passo 8 — Telemetria interna (Cano 4, fase 1 — ver src/core/telemetria.js).
    // Só instrumentação sobre o que já foi produzido acima — zero IA, zero API
    // externa, nunca bloqueia.
    registrarCompilacao({
        timestamp:    new Date().toISOString(),
        nichoTema:    params.nichoTema || null,
        versaoDossie: dossieDoNicho ? dossieDoNicho.versaoDossie : null,
        pecasUsadas:  dossieDoNicho ? dossieDoNicho.pecas.map(p => p.id) : [],
        validadoresPassaram: {
            xmlSemAvisos:        avisos.length === 0,
            dossieDomIds:        dossieDoNicho ? true : null, // chegou aqui sem lançar no Passo 5b ⇒ passou
            diagnosticoSemErros: diagnosticoErros === null ? null : diagnosticoErros === 0,
        },
        pecaGeradaPorIA: dossieDoNicho ? dossieDoNicho.pecas.some(p => p.origem === 'ia-gerada') : false,
    });

    return {
        xmlFinal,
        avisos,
        reparosXml,
        injecoesPackage,
        slug:               params.slug,
        siteNameSanitizado: params.siteNameSanitizado,
        modulosAtivos:      params.modulosAtivos,
        badgesProcessados:  params.badgesProcessados,
        meta: {
            linhas:           xmlFinal.split('\n').length,
            tamanhoKb:        (Buffer.byteLength(xmlFinal, 'utf8') / 1024).toFixed(1),
            siteName:         params.siteNameSanitizado,
            seo:              params.seoAtivo,
            modulos:          Object.keys(params.modulosAtivos).filter(k => params.modulosAtivos[k]),
            badges:           params.badgesProcessados.length,
            grafo: {
                totalSlots:      trace.length,
                slotsAtivos,
                camposInfluentes,
            },
        },
    };
}

module.exports = {
    executarCompilacao,
    validarManifesto,
    validarXmlSaida,
    carregarChassisParaNicho,
    verificarMarcadoresDesignPackage,
};
