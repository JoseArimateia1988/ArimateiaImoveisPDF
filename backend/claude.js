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
  "titulo": "nome do empreendimento ou tipo e descrição curta",
  "endereco": "endereço completo",
  "bairro": "bairro",
  "cidade": "cidade e estado",
  "descricao": "descrição completa do imóvel",
  "caracteristicas": ["lista", "de", "diferenciais"],
  "total_andares": "total de andares ou null",
  "tipologias": [
    {
      "tipo": "descrição da tipologia (ex: 2 Dorms, Studio, Cobertura)",
      "area_util": "área privativa em m² ou null",
      "area_total": "área total em m² ou null",
      "quartos": "número de quartos ou null",
      "suites": "número de suítes ou null",
      "banheiros": "número de banheiros ou null",
      "vagas": "número de vagas ou null",
      "preco_venda": "valor de venda formatado em reais ou null",
      "preco_aluguel": "valor de aluguel formatado em reais ou null",
      "condominio": "valor do condomínio ou null",
      "iptu": "valor do IPTU ou null"
    }
  ]
}

IMPORTANTE sobre tipologias:
- Crie UMA entrada por linha/variação de preço ou metragem que aparecer na página.
- Se a página mostrar uma tabela com várias linhas (ex: R$ 1.785.821 / 95m² / 3 dorms, R$ 2.674.429 / 128m² / 3 dorms), crie um objeto para CADA linha.
- O campo "tipo" deve descrever a variação: "3 Dorms · 95m²", "3 Dorms · 128m²", "4 Dorms · 153m²", etc.
- Se o imóvel tiver UMA única unidade (apartamento usado, casa), crie um array com UM objeto.
- Nunca deixe o array vazio. Sempre extraia pelo menos uma tipologia.`;

export async function extractImovelData(text, url) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').replace(/\s/g, '');

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: PROMPT(text, url) }],
  });

  const raw = message.content[0].text.trim();
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}
