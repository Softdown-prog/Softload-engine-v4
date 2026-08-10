'use strict';

// ==========================================
// FONTE (Google Fonts)
// ==========================================

function gerarFontModule(typography) {
    const safeFontUrl = typography.fontUrl ? typography.fontUrl.replace(/&/g, '&amp;') : '';

    return `<link rel='preconnect' href='https://fonts.googleapis.com'/>
    <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin='anonymous'/>
    <link href='${safeFontUrl}' rel='stylesheet'/>`;
}

module.exports = { gerarFontModule };
