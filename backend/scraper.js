import axios from 'axios';
import * as cheerio from 'cheerio';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

export async function fetchPageContent(url) {
  const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, nav, footer, header, [class*="cookie"], [class*="banner"], [id*="chat"]').remove();

  // Extract images before stripping attributes
  const images = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (src && /\.(jpg|jpeg|png|webp)/i.test(src) && !src.includes('icon') && !src.includes('logo')) {
      const absolute = src.startsWith('http') ? src : new URL(src, url).href;
      if (!images.includes(absolute)) images.push(absolute);
    }
  });

  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);

  return { text, images: images.slice(0, 20) };
}
