import Anthropic from '@anthropic-ai/sdk';

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

export async function extractImovelData(text, url) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/\s/g, '');

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: PROMPT(text, url) }],
  });

  const raw = message.content[0].text.trim();
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}
