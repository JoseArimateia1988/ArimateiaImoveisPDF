import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchPageContent } from './scraper.js';
import { extractImovelData } from './claude.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve o frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

app.post('/api/extrair', async (req, res) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ erro: 'Envie um array de URLs no campo "urls".' });
  }

  if (urls.length > 10) {
    return res.status(400).json({ erro: 'Máximo de 10 imóveis por vez.' });
  }

  const resultados = await Promise.allSettled(
    urls.map(async (url) => {
      const { text, images } = await fetchPageContent(url);
      const dados = await extractImovelData(text, url);
      return { ...dados, fotos: images, url_origem: url };
    })
  );

  const imoveis = resultados.map((r, i) => {
    if (r.status === 'fulfilled') return { ok: true, dados: r.value };
    console.error(`Erro na URL ${urls[i]}:`, r.reason?.message);
    return { ok: false, url: urls[i], erro: r.reason?.message || 'Erro desconhecido' };
  });

  res.json({ imoveis });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  const key = process.env.ANTHROPIC_API_KEY;
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`ANTHROPIC_API_KEY: ${key ? key.slice(0,20) + '...' : 'NÃO ENCONTRADA'}`);
});
