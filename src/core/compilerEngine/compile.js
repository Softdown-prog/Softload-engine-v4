'use strict';

const { COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS } = require('../presets');
const { resolverModulos, DROPCAP_CSS, escolherIconeAutor } = require('../modules');
const { gerarDesignVoiceCss } = require('../designVoicePresets');
const { GRID_OPTIONS, SLOT_MANIFEST } = require('./slotManifest');
const { sanitizarEntidadesXml, injetarHeroTexto } = require('./xmlEntities');
const { gerarSeoModule } = require('./seo');
const { gerarFontModule } = require('./fonts');
const { gerarHeaderWidget, montarWidgetHtml, gerarNavWidget } = require('./widgets');
const {
    gerarDynamicCss,
    gerarTypographyCss,
    gerarCategoryBadgesCss,
    gerarButtonCss,
    gerarGridCardCss,
} = require('./designTokensCss');
const {
    gerarLayoutCss,
    resolverLayoutClasses,
    gerarFooterNewsletter,
} = require('./layout');
const { carregarNichoImplComBlocos } = require('./nichoBlocks');
const { detectarOrfaos } = require('./orphans');
const { gerarPlaceholderImagemSvg } = require('./placeholderImage');

// ==========================================
// MOTOR PRINCIPAL
// ==========================================

/**
 * Compila o template XML do Blogger aplicando o manifesto de opções do usuário.
 *
 * Fluxo (Chassis + DNA):
 *  1. Carrega o Chassis (templateBase — imutável, passado pelo caller)
 *  2. Lê o Manifesto JSON (opcoes)
 *  3. Resolve todos os valores ANTES de injetar (permite capturar trace)
 *  4. Aplica DNA via split/join em placeholders exatos
 *  5. Remove placeholders órfãos — garante XML limpo
 *
 * Retorna { xml, trace } onde trace é um array de ASTNode-like:
 *   { slot, type, valueBytes, active, sources }
 * Use construirGrafoCampos(trace) para obter o grafo de dependências.
 */
function compilarTemplate(templateBase, opcoes) {
    const {
        siteName, description, enableSeo, gridLayout, colorPreset,
        buttonStyle, typography, modules, categoryBadges, lazyLoad,
        nichoTema, footerStyle, sidebarPosition, heroTitle, heroSubtitle,
        designVoice, temHeroDesignPackage,
    } = opcoes;

    const color      = COLOR_PRESETS[colorPreset]     ?? COLOR_PRESETS['tech-blue'];
    const button     = BUTTON_STYLES[buttonStyle]     ?? BUTTON_STYLES['default'];
    const typo       = TYPOGRAPHY_PRESETS[typography] ?? TYPOGRAPHY_PRESETS['inter'];
    const gridClass  = GRID_OPTIONS[gridLayout]       ?? GRID_OPTIONS.revista;

    // ── Resolver todos os valores antes de injetar ─────────────────────────
    const seoValue      = enableSeo ? gerarSeoModule(siteName, description) : '<!-- SEO desativado -->';
    const fontValue     = gerarFontModule(typo);
    const dynamicCss    = gerarDynamicCss({ color, button, typography: typo });
    const badgesCss     = gerarCategoryBadgesCss(categoryBadges || []);
    const buttonCss     = gerarButtonCss(buttonStyle || 'default', color.primary);
    const layoutCss     = gerarLayoutCss({ footerStyle, sidebarPosition });
    const voiceCss      = gerarDesignVoiceCss(designVoice);
    const dropcapCss    = modules && modules.dropcap ? DROPCAP_CSS : '';
    const fullCss       = dynamicCss
        + (badgesCss ? '\n    ' + badgesCss : '')
        + '\n    ' + buttonCss
        + (layoutCss ? '\n    ' + layoutCss : '')
        + '\n    ' + gerarTypographyCss(typo)
        + '\n    ' + gerarGridCardCss()
        + (voiceCss   ? '\n    ' + voiceCss   : '')
        + (dropcapCss ? '\n    ' + dropcapCss : '');
    const lazyValue     = lazyLoad ? "loading='lazy'" : '';
    // Placeholder de imagem (card sem foto de post) — gerado com as cores
    // reais do colorPreset do site, self-contained (data URI), nunca
    // depende de serviço externo nem escreve "Softload" no card de um
    // site de cliente. Ver placeholderImage.js pro achado completo.
    const placeholderImg = gerarPlaceholderImagemSvg(color.primary, color.bgBody);
    // Seed determinístico (mesmo princípio de carregarNichoImplComBlocos) —
    // escolhe variante de ícone (dark mode/back-to-top/autor) por site, nunca
    // Math.random(): mesmo siteName+nicho sempre recebe o mesmo ícone entre
    // recompilações; sites diferentes tendem a variar.
    const iconSeed      = (siteName || '') + nichoTema;
    const modSnippets   = resolverModulos(modules || {}, iconSeed);
    const iconAuthor    = escolherIconeAutor(iconSeed);
    const nichoImpl     = carregarNichoImplComBlocos(nichoTema, siteName);

    // Layout: classe do <body> + faixa de newsletter (quando aplicável)
    const bodyLayoutClass = resolverLayoutClasses({ footerStyle, sidebarPosition });
    const footerNewsletter = footerStyle === 'newsletter-integrated'
        ? sanitizarEntidadesXml(gerarFooterNewsletter())
        : '';

    // Breaking news bar: só se o placeholder existir no template
    const breakingNewsBar = templateBase.includes('[[BREAKING_NEWS_BAR]]')
        ? `<div class='mag-ticker-bar'>
    <div class='container d-flex align-items-center overflow-hidden' style='height:32px;'>
      <span class='mag-ticker-label'>&#9654; Últimas</span>
      <div class='mag-ticker-track'>
        <div class='mag-ticker-content' id='mag-ticker-items'>
          <span>A carregar notícias recentes...</span>
        </div>
      </div>
    </div>
  </div>`
        : '';

    // H1 de fallback, oculto visualmente — achado real (auditoria SEO com
    // template real de usuário): a home de TODO nicho renderiza só h2/h3 no
    // hero (nunca h1 — o h1 real só existe na view de post único, ver
    // template_*.xml), e pelo menos 8 dos 15 nichos migrados têm hero 100%
    // visual (tira/badge/slider JS) sem heading nenhum — a home inteira
    // ficava sem NENHUM <h1> no site. hero-area só renderiza em
    // data:view.isMultipleItems, mutuamente exclusivo da view de post único
    // — nunca colide com o h1 real do post. Só injeta quando o hero do
    // nicho (heroHtml OU heroNativoXml) ainda não tem h1 próprio — nunca
    // duplica. data:blog.title é sempre um candidato correto de H1 quando
    // não há nada mais específico (é literalmente o nome do site).
    const H1_FALLBACK_OCULTO = "<h1 class='visually-hidden'><data:blog.title/></h1>";
    const heroHtmlComTexto = injetarHeroTexto(nichoImpl.heroHtml || '', heroTitle, heroSubtitle);
    const heroJaTemH1 = /<h1\b/i.test(heroHtmlComTexto) || /<h1\b/i.test(nichoImpl.heroNativoXml || '');

    // ── Mapa slot → valor resolvido ────────────────────────────────────────
    // Módulos: strip dos colchetes duplos para obter chave limpa
    const modMap = {};
    for (const [k, v] of Object.entries(modSnippets)) {
        modMap[k.replace(/^\[\[|\]\]$/g, '')] = v;
    }

    const resolvedMap = {
        THEME_COLOR:           color.primary,
        SEO_MODULE:            seoValue,
        FONT_MODULE:           fontValue,
        DYNAMIC_CSS:           fullCss,
        GRID_CLASS:            gridClass,
        LAZY_LOAD_TOGGLE:      lazyValue,
        PLACEHOLDER_IMG:       placeholderImg,
        NICHO_CSS:             nichoImpl.css      || '',
        NICHO_JS:              nichoImpl.js       || '',
        // Hero embrulhado em widget HTML → editável no painel de Layout do Blogger.
        // Quando o design package traz heroHtml próprio (injetado depois, em
        // injetarDesignPackage), ele SUBSTITUI o hero padrão do nicho — mesmo
        // princípio de customCss/svgLogo já sobrescreverem o default. Sem isso,
        // as duas heros renderizavam juntas na home (achado real do
        // diagnostico-sweep: 5 design packages com 2 <h1> no mesmo escopo).
        // heroNativoXml (nichoBlocks.js/widgets.js): hero servido por widget
        // NATIVO do Blogger (ex: FeaturedPost) com dado real de post — nunca
        // passa por injetarHeroTexto/montarWidgetHtml, que só fazem sentido
        // pra HTML estático. H1_FALLBACK_OCULTO só entra no ramo heroHtml
        // (mesmo widget HTML, mesmo CDATA — sempre válido); heroNativoXml é
        // um <b:widget> e não pode ganhar uma tag solta como irmã dentro de
        // <b:section> (Blogger rejeita), mas hoje o único nicho nesse ramo
        // (noticias-mag-news) já tem h1 próprio no FeaturedPost, então
        // heroJaTemH1 cobre esse caso sem precisar desse ramo extra.
        NICHO_HERO:            temHeroDesignPackage ? '' : (nichoImpl.heroNativoXml || montarWidgetHtml('HTML89', 'Hero', (heroJaTemH1 ? '' : H1_FALLBACK_OCULTO) + heroHtmlComTexto)),
        // HTML de peças "widget"/"modulo" do dossiê do nicho (banner de
        // cookie, botão voltar-ao-topo, preloader etc) — só populado pelo
        // cano novo (montarNichoDeDossie em nichoBlocks.js); nichos ainda
        // no cano legado sempre resolvem '' aqui, sem regressão.
        NICHO_WIDGETS_HTML:    nichoImpl.widgetsHtml || '',
        // Peças tipo:'secao' do dossiê — <b:widget> Blogger REGISTRADO de
        // verdade (BlogSearch, HTML com destaque de posts), que precisa da
        // própria <b:section> (schema do Blogger só aceita b:widget como
        // filho direto de b:section — não cabe em NICHO_WIDGETS_HTML, que é
        // pra HTML solto). Só populado pelo cano novo, igual acima.
        NICHO_EXTRA_SECTIONS:  nichoImpl.extraSecoesHtml || '',
        BREAKING_NEWS_BAR:     breakingNewsBar,
        BODY_LAYOUT_CLASS:     bodyLayoutClass,
        FOOTER_NEWSLETTER:     footerNewsletter,
        HEADER_WIDGET:         gerarHeaderWidget(),
        NAV_WIDGET:            gerarNavWidget(),
        // 2ª instância do widget de navegação (id diferente, mesmo
        // data:pages) — usada DENTRO do painel mobile (collapse/offcanvas/
        // hambúrguer, ver MOBILE_MENU_* em modules.js). Sem isso o painel
        // mobile abria vazio: a b:section de dentro dele nunca tinha
        // widget nenhum, só um placeholder auto-fechado esperando o dono
        // do site arrastar um gadget manualmente no painel de Layout.
        MOBILE_NAV_WIDGET:     gerarNavWidget('PageList2'),
        ICON_AUTHOR:           iconAuthor,
        ...modMap,
    };

    // ── Injeção DNA ────────────────────────────────────────────────────────
    let xml = templateBase;

    xml = xml.split('[[THEME_COLOR]]').join(resolvedMap.THEME_COLOR);
    xml = xml.split('[[SEO_MODULE]]').join(resolvedMap.SEO_MODULE);
    xml = xml.split('[[FONT_MODULE]]').join(resolvedMap.FONT_MODULE);
    xml = xml.split('[[DYNAMIC_CSS]]').join(resolvedMap.DYNAMIC_CSS);
    xml = xml.split('[[GRID_CLASS]]').join(resolvedMap.GRID_CLASS);
    xml = xml.split('[[LAZY_LOAD_TOGGLE]]').join(resolvedMap.LAZY_LOAD_TOGGLE);

    for (const [placeholder, snippet] of Object.entries(modSnippets)) {
        xml = xml.split(placeholder).join(snippet);
    }

    // Marcadores DP:CSS:*/DP:HERO:* (mesma convenção já usada por
    // injetarDesignPackage() em compilerWorker.js pro caminho legado de
    // body.customCss/body.heroHtml) — achado real: templateExtractor.js só
    // sabe extrair CSS/hero com qualidade via esses marcadores; sem eles,
    // caía na heurística de fallback (posição/classe), que não reconhece a
    // estrutura do dossiê e devolvia lixo ('<div class="row">' como hero
    // inteiro). Envolver aqui faz QUALQUER compilação por nicho (dossiê ou
    // legado) virar um design-package reextraível com qualidade real —
    // não só os poucos templates que passam por injetarDesignPackage.
    // Só envolve quando não-vazio (marcador vazio não ajuda em nada e só
    // suja o XML). CSS: seguro porque [[NICHO_CSS]] já fica dentro do CDATA
    // do <b:skin> (confirmado no template_*.xml) — mesma posição que
    // injetarDesignPackage usa pro customCss legado. Comentário HTML dentro
    // de CSS é sintaxe válida (tokens CDO/CDC do próprio spec de CSS,
    // histórico de compatibilidade com <style><!-- --></style>), navegador e
    // PostCSS tratam como no-op — não quebra parsing.
    const nichoCssComMarcador = resolvedMap.NICHO_CSS
        ? '\n<!-- DP:CSS:START -->\n' + resolvedMap.NICHO_CSS + '\n<!-- DP:CSS:END -->\n'
        : resolvedMap.NICHO_CSS;
    const nichoHeroComMarcador = resolvedMap.NICHO_HERO
        ? '\n<!-- DP:HERO:START -->\n' + resolvedMap.NICHO_HERO + '\n<!-- DP:HERO:END -->\n'
        : resolvedMap.NICHO_HERO;

    xml = xml.split('[[NICHO_CSS]]').join(nichoCssComMarcador);
    xml = xml.split('[[NICHO_JS]]').join(resolvedMap.NICHO_JS);
    xml = xml.split('[[NICHO_HERO]]').join(nichoHeroComMarcador);
    xml = xml.split('[[NICHO_WIDGETS_HTML]]').join(resolvedMap.NICHO_WIDGETS_HTML);
    xml = xml.split('[[NICHO_EXTRA_SECTIONS]]').join(resolvedMap.NICHO_EXTRA_SECTIONS);
    // Depois dos blocos de nicho de propósito: alguns pedaços de JS/HTML
    // autorais de dossiê (ex: slider de posts sem imagem) também usam
    // [[PLACEHOLDER_IMG]] — precisa rodar depois desses 4 acima pra pegar
    // o token que só chega no xml quando NICHO_JS/NICHO_HERO são injetados.
    xml = xml.split('[[PLACEHOLDER_IMG]]').join(resolvedMap.PLACEHOLDER_IMG);
    xml = xml.split('[[BREAKING_NEWS_BAR]]').join(resolvedMap.BREAKING_NEWS_BAR);
    xml = xml.split('[[BODY_LAYOUT_CLASS]]').join(resolvedMap.BODY_LAYOUT_CLASS);
    xml = xml.split('[[FOOTER_NEWSLETTER]]').join(resolvedMap.FOOTER_NEWSLETTER);
    xml = xml.split('[[HEADER_WIDGET]]').join(resolvedMap.HEADER_WIDGET);
    xml = xml.split('[[NAV_WIDGET]]').join(resolvedMap.NAV_WIDGET);
    xml = xml.split('[[MOBILE_NAV_WIDGET]]').join(resolvedMap.MOBILE_NAV_WIDGET);
    xml = xml.split('[[ICON_AUTHOR]]').join(resolvedMap.ICON_AUTHOR);

    // Pós-compilação: remove placeholders não substituídos.
    xml = detectarOrfaos(xml);

    // ── Trace: ASTNode-like para cada slot do manifesto ────────────────────
    const trace = SLOT_MANIFEST.map(def => {
        const val = resolvedMap[def.slot] || '';
        return {
            slot:       def.slot,
            type:       def.type,
            valueBytes: Buffer.byteLength(val, 'utf8'),
            active:     val.length > 0,
            sources:    def.sources,
        };
    });

    return { xml, trace };
}

module.exports = { compilarTemplate };
