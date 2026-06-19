import { GoogleGenerativeAI } from '@google/generative-ai';

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

const PROMPT = (text, url) => `Você é um assistente especializado em extrair dados de imóveis de páginas web brasileiras.
Extraia SOMENTE o que estiver explicitamente na página. Se um campo não existir, use null.
Responda APENAS com JSON válido, sem markdown, sem explicações.

URL: ${url}

CONTEÚDO DA PÁGINA:
${text}

Retorne JSON com EXATAMENTE esta estrutura:
{
  "codigo": "código do imóvel (ex: REO752970)",
  "titulo": "tipo e descrição curta",
  "endereco": "endereço completo",
  "bairro": "bairro",
  "cidade": "cidade e estado",
  "preco_venda": "valor de venda formatado em reais ou null",
  "preco_aluguel": "valor de aluguel formatado em reais ou null",
  "condominio": "valor do condomínio ou null",
  "iptu": "valor do IPTU ou null",
  "area_util": "área útil em m²",
  "area_total": "área total em m² ou null",
  "quartos": null,
  "suites": null,
  "banheiros": null,
  "vagas": null,
  "descricao": "descrição completa do imóvel",
  "caracteristicas": ["lista", "de", "diferenciais"],
  "andar": "andar ou null",
  "total_andares": "total de andares ou null"
}`;

export async function extractImovelData(text, url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const result = await model.generateContent(PROMPT(text, url));
      const raw = result.response.text().trim();
      const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      return JSON.parse(json);
    } catch (err) {
      const sobrecarga = err?.message?.includes('503') || err?.message?.includes('overloaded') || err?.message?.includes('high demand');
      if (sobrecarga && i < tentativas - 1) {
        await new Promise(r => setTimeout(r, 3000 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}
