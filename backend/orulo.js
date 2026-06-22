import axios from 'axios';

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
  // 95.0 -> "95", 153.05 -> "153,05"
  return String(n).replace('.', ',').replace(/,0+$/, '');
};

export function isOruloUrl(url) {
  return /orulo\.com\.br/i.test(url);
}

// Extrai building_id e publicKey da página de compartilhamento
async function getCredentials(url) {
  const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 25000 });

  const pkMatch = html.match(/var\s+publicKey\s*=\s*['"]([^'"]+)['"]/);
  const idMatch = html.match(/var\s+building_id\s*=\s*(\d+)/);

  // building_id também pode vir do JWT na URL (base64)
  let buildingId = idMatch ? idMatch[1] : null;
  if (!buildingId) {
    const jwtMatch = url.match(/jwt=([^&]+)/);
    if (jwtMatch) {
      try {
        const payload = jwtMatch[1].split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        buildingId = String(decoded.building_id);
      } catch {}
    }
  }

  if (!buildingId || !pkMatch) {
    throw new Error('Não foi possível ler credenciais do Órulo (publicKey/building_id).');
  }
  return { buildingId, publicKey: pkMatch[1] };
}

async function apiGet(path, publicKey) {
  const { data } = await axios.get(`https://www.orulo.com.br/api/v2${path}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${publicKey}` },
    timeout: 25000,
  });
  return data;
}

// Retorna objeto completo do imóvel, pronto para o frontend (sem passar pela IA)
export async function fetchOruloImovel(url) {
  const { buildingId, publicKey } = await getCredentials(url);

  const [building, tipoData, imgData] = await Promise.all([
    apiGet(`/buildings/${buildingId}`, publicKey),
    apiGet(`/buildings/${buildingId}/typologies`, publicKey),
    apiGet(`/buildings/${buildingId}/images?dimensions[]=2280x1800`, publicKey).catch(() => ({ images: [] })),
  ]);

  const addr = building.address || {};
  const enderecoPartes = [addr.street_type, addr.street, addr.number].filter(Boolean).join(' ');
  const cidadeEstado = [addr.city, addr.state].filter(Boolean).join('/');

  // Tipologias — uma por linha
  const tipologias = (tipoData.typologies || []).map((t) => ({
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

  // Remove duplicatas exatas (mesma área + preço)
  const vistos = new Set();
  const tipologiasUnicas = tipologias.filter((t) => {
    const chave = `${t.area_util}|${t.preco_venda}|${t.quartos}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  const fotos = (imgData.images || [])
    .map((i) => i['2280x1800'] || i.url)
    .filter(Boolean);

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
  };
}
