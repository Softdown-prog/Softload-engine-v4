'use strict';

const { sanitizarInput } = require('./sanitize');

// ==========================================
// SEO
// ==========================================

// escapa string pra caber com segurança dentro de um literal JSON-LD
// (o próprio <script type='application/ld+json'> não passa por parser
// Blogger, então & < > também precisam virar \uXXXX, não &amp;/&lt;/&gt;).
function _paraJsonLd(texto) {
    return JSON.stringify(String(texto || ''))
        .replace(/&/g, '\\u0026')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
}

/**
 * @param {string} siteName
 * @param {string} [description] — descrição real do site/negócio (campo
 *   `description` do manifesto, capturado na conversa do chat). Achado
 *   real (auditoria com template de usuário real): antes deste fix, a
 *   <meta name='description'> de TODO site gerado era literalmente só o
 *   siteName ("Nik", 3 letras) — a descrição que o usuário digitou na
 *   conversa nunca chegava aqui (normalizarManifesto não repassava o
 *   campo). data:blog.metaDescription (config nativa do Blogger, quando o
 *   dono configura descrição de busca por post/blog) tem prioridade — é
 *   mais específica por página; a description do chat é o fallback real
 *   (bem melhor que repetir o nome do site); siteName só como último
 *   recurso, se nem isso existir.
 */
function gerarSeoModule(siteName, description) {
    const safeSiteName = sanitizarInput(siteName);
    const descricaoLimpa = sanitizarInput(description || '').slice(0, 160);
    const descricaoFallback = descricaoLimpa || safeSiteName;

    return `
    <!-- SEO Premium - Gerado pelo Softload Engine -->
    <b:if cond='data:blog.metaDescription'>
      <meta expr:content='data:blog.metaDescription' name='description'/>
    <b:else/>
      <meta content='${descricaoFallback}' name='description'/>
    </b:if>
    <link expr:href='data:blog.homepageUrl' rel='canonical'/>
    <b:if cond='data:view.isHomepage'>
      <meta content='index, follow' name='robots'/>
    <b:else/>
      <meta content='index, follow, max-snippet:-1, max-image-preview:large' name='robots'/>
    </b:if>
    <script type='application/ld+json'>
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": ${_paraJsonLd(siteName)}${descricaoLimpa ? `,\n      "description": ${_paraJsonLd(descricaoLimpa)}` : ''},
      "url": "<data:blog.homepageUrl/>"
    }
    </script>`.trim();
}

module.exports = { gerarSeoModule };
