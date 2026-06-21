import puppeteer from 'puppeteer-core';

// Localização do Chromium no Railway (Nixpacks instala aqui)
const CHROME_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/nix/store',  // fallback — vai procurar abaixo
];

async function findChromium() {
  const { execSync } = await import('child_process');
  for (const p of CHROME_PATHS) {
    try {
      if (p === '/nix/store') {
        const result = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null', { encoding: 'utf8' }).trim();
        if (result) return result;
      } else {
        execSync(`test -f ${p}`, { stdio: 'ignore' });
        return p;
      }
    } catch {}
  }
  throw new Error('Chromium não encontrado no sistema');
}

export async function fetchOruloContent(url) {
  const executablePath = await findChromium();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Aguarda o carrossel carregar
    await page.waitForSelector('#orulo_carousel, .carousel, img[src*="orulo"]', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    // Clica nas setas do carrossel para forçar carregamento de todas as fotos
    for (let i = 0; i < 25; i++) {
      await page.click('.carousel-control.right, .next, [data-slide="next"], .slick-next').catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }

    // Coleta todas as imagens do domínio do Orulo
    const images = await page.evaluate(() => {
      const urls = new Set();
      // Imagens no DOM
      document.querySelectorAll('img').forEach(img => {
        ['src', 'data-src', 'data-lazy-src'].forEach(attr => {
          const v = img.getAttribute(attr);
          if (v && v.includes('static.orulo.com.br') && /\.(jpg|jpeg|png|webp)/i.test(v)) {
            // Converte thumb para large
            urls.add(v.replace('/thumb/', '/large/').replace('/medium/', '/large/'));
          }
        });
      });
      // Verifica também via fetch de imagens já carregadas pelo browser
      performance.getEntriesByType('resource').forEach(r => {
        if (r.name.includes('static.orulo.com.br') && /\.(jpg|jpeg|png|webp)/i.test(r.name)) {
          urls.add(r.name.replace('/thumb/', '/large/').replace('/medium/', '/large/'));
        }
      });
      return [...urls].filter(u => !u.includes('logo') && !u.includes('icon') && !u.includes('badge'));
    });

    // Texto da página
    const text = await page.evaluate(() =>
      document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 8000)
    );

    return { text, images: images.slice(0, 30) };
  } finally {
    await browser.close();
  }
}
