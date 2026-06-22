import axios from 'axios';
import * as cheerio from 'cheerio';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

function extrairImagens($, url, html) {
  const images = [];
  const add = (src) => {
    if (!src) return;
    if (!/\.(jpg|jpeg|png|webp)/i.test(src)) return;
    if (/icon|logo|sprite|placeholder/i.test(src)) return;
    const absolute = src.startsWith('http') ? src : new URL(src, url).href;
    if (!images.includes(absolute)) images.push(absolute);
  };

  // Atributos padrão de imagens (lazy load incluso)
  $('img').each((_, el) => {
    const attrs = ['src','data-src','data-lazy-src','data-original','data-url','data-image'];
    for (const a of attrs) add($(el).attr(a));
    const srcset = $(el).attr('srcset') || $(el).attr('data-srcset') || '';
    srcset.split(',').forEach(s => add(s.trim().split(' ')[0]));
  });

  // <source srcset> dentro de <picture>
  $('source').each((_, el) => {
    const srcset = $(el).attr('srcset') || $(el).attr('data-srcset') || '';
    srcset.split(',').forEach(s => add(s.trim().split(' ')[0]));
  });

  // Elementos com background-image inline
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const m = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
    if (m) add(m[1]);
  });

  // JSON embutido em <script> (SPAs como Orulo embutem estado inicial)
  $('script').each((_, el) => {
    const content = $(el).html() || '';
    const matches = content.matchAll(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    for (const m of matches) add(m[1].replace(/\\u002F/g, '/'));
  });

  // Busca em atributos de divs/spans (alguns carrosséis usam data-*)
  $('[data-background],[data-bg],[data-photo],[data-image-url]').each((_, el) => {
    ['data-background','data-bg','data-photo','data-image-url'].forEach(a => add($(el).attr(a)));
  });

  return images.slice(0, 30);
}

export async function fetchPageContent(url) {
  const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(html);

  // Remove noise
  $('script[src], style, nav, footer, header, [class*="cookie"], [class*="banner"], [id*="chat"]').remove();

  const images = extrairImagens($, url, html);

  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);

  return { text, images };
}
