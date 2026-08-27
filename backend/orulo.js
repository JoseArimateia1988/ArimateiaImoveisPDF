const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const fmtBRL = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};

const fmtArea = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return String(n).replace('.', ',').replace(/,0+$/, '');
};

export function isOruloUrl(url) {
  return /orulo\.com\.br/i.test(url);
}

function assertPilotEnabled() {
  if (process.env.ORULO_SHARE_LINKS_ENABLED !== 'true') {
    const e = new Error('Integração Órulo ainda não habilitada. Para o piloto, configure ORULO_SHARE_LINKS_ENABLED=true. Para uso comercial, use a integração oficial da Órulo.');
    e.code = 'ORULO_OFFICIAL_INTEGRATION_REQUIRED';
    throw e;
  }
}

async function fetchOrulo(url, { headers = HEADERS, responseType = 'json' } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    throw new Error(`Falha ao acessar a Órulo: ${error?.message || 'erro de conexão'}`);
  }

  if (!response.ok) {
    throw new Error(`Órulo respondeu com status ${response.status}.`);
  }

  if (responseType === 'text') return response.text();
  return response.json();
}

async function getCredentials(url) {
  assertPilotEnabled();
  // Usa fetch nativo para manter compatibilidade com Cloudflare Workers.
  // O adapter fetch do Axios envia cache="default", modo não aceito pelo runtime do Worker.
  const html = await fetchOrulo(url, { responseType: 'text' });
  const pkMatch = html.match(/var\s+publicKey\s*=\s*['"]([^'"]+)['"]/);
  const idMatch = html.match(/var\s+building_id\s*=\s*(\d+)/);

  let buildingId = idMatch ? idMatch[1] : null;
  if (!buildingId) {
    const jwtMatch = url.match(/jwt=([^&]+)/);
    if (jwtMatch) {
      try {
        const payload = jwtMatch[1].split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        buildingId = String(decoded.building_id);
      } catch {}
    }
  }

  if (!buildingId || !pkMatch) throw new Error('Não foi possível ler os dados do link compartilhado da Órulo.');
  return { buildingId, publicKey: pkMatch[1] };
}

async function apiGet(path, publicKey) {
  return fetchOrulo(`https://www.orulo.com.br/api/v2${path}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${publicKey}` },
  });
}

function listaDaResposta(data, chaves = []) {
  if (Array.isArray(data)) return data;
  for (const chave of chaves) if (Array.isArray(data?.[chave])) return data[chave];
  return [];
}

function urlDeMidia(item) {
  if (!item) return null;
  if (typeof item === 'string') return item;
  const dimensions = item.dimensions || item.urls || item.images || {};
  return item['2280x1800'] || dimensions['2280x1800'] || item['1920x1080'] || dimensions['1920x1080'] || item['1024x1024'] || dimensions['1024x1024'] || item.url || item.image || item.src || null;
}

// Fluxo legado mantido apenas para homologação com a conta do corretor piloto.
// O produto comercial deverá usar OAuth/credenciais oficiais da integração Órulo.
export async function fetchOruloImovel(url) {
  const { buildingId, publicKey } = await getCredentials(url);

  const [building, tipoData, imgData, floorData] = await Promise.all([
    apiGet(`/buildings/${buildingId}`, publicKey),
    apiGet(`/buildings/${buildingId}/typologies`, publicKey),
    apiGet(`/buildings/${buildingId}/images?dimensions[]=2280x1800`, publicKey).catch(() => ({ images: [] })),
    apiGet(`/buildings/${buildingId}/floor_plans?dimensions[]=1024x1024&dimensions[]=2280x1800`, publicKey).catch(() => ({ floor_plans: [] })),
  ]);

  const addr = building.address || {};
  const enderecoPartes = [addr.street_type, addr.street, addr.number].filter(Boolean).join(' ');
  const cidadeEstado = [addr.city, addr.state].filter(Boolean).join('/');

  const tiposRaw = listaDaResposta(tipoData, ['typologies', 'items', 'data']);
  const tipologias = tiposRaw.map((t) => ({
    tipo: t.type || 'Apartamento',
    area_util: fmtArea(t.private_area),
    area_total: null,
    quartos: t.bedrooms ?? null,
    suites: t.suites ?? null,
    banheiros: t.bathrooms ?? null,
    vagas: t.parking ?? null,
    preco_venda: fmtBRL(t.discount_price ?? t.original_price),
    preco_aluguel: null,
    condominio: null,
    iptu: null,
  }));

  const vistosTipos = new Set();
  const tipologiasUnicas = tipologias.filter((t) => {
    const chave = `${t.area_util}|${t.preco_venda}|${t.quartos}`;
    if (vistosTipos.has(chave)) return false;
    vistosTipos.add(chave);
    return true;
  });

  const fotosVistas = new Set();
  const fotos = listaDaResposta(imgData, ['images', 'items', 'data'])
    .map(urlDeMidia)
    .filter((u) => {
      if (!u || fotosVistas.has(u)) return false;
      fotosVistas.add(u);
      return true;
    });

  const plantasVistas = new Set();
  const plantas = listaDaResposta(floorData, ['floor_plans', 'floorPlans', 'plans', 'items', 'data'])
    .map((p) => ({
      id: p?.id ?? null,
      descricao: p?.description || p?.name || p?.title || null,
      tipo: p?.type || null,
      associations: p?.associations || p?.typologies || null,
      url: urlDeMidia(p),
    }))
    .filter((p) => {
      if (!p.url || plantasVistas.has(p.url)) return false;
      plantasVistas.add(p.url);
      return true;
    });

  return {
    codigo: building.id ? `ORL${building.id}` : null,
    titulo: building.name || 'Empreendimento',
    endereco: enderecoPartes || null,
    bairro: addr.area || null,
    cidade: cidadeEstado || null,
    descricao: building.description || null,
    caracteristicas: building.features || [],
    total_andares: building.number_of_floors ?? null,
    tipologias: tipologiasUnicas.length ? tipologiasUnicas : tipologias,
    fotos,
    plantas,
  };
}
