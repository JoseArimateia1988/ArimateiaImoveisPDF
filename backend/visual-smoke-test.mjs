import assert from 'node:assert/strict';
import { clientPageV4 } from './client-v4.js';
import { resultPageV2 } from './result-v2.js';

const modelos = {
  editorial: { nome:'Bordeaux', cor:'#4a1a23' },
  clean: { nome:'Arquitetônico', cor:'#23364b' },
  bold: { nome:'Expressivo', cor:'#2b1f17' },
  minimal: { nome:'Sálvia', cor:'#6f7a61' }
};

const base = {
  id:'qa123',
  user_id:'u1',
  cliente:'Camila',
  criado_em:'2026-08-14T12:00:00.000Z',
  perfil:{nome:'José Arimateia',creci:'CRECI 00000',email:'corretor@example.com'},
  imoveis:[{ok:true,dados:{titulo:'Residencial Horizonte',codigo:'QA01',bairro:'Vila Mariana',cidade:'São Paulo',endereco:'Rua Exemplo, 100',tipologias:[{preco_venda:'R$ 920.000',area_util:'82',quartos:2,suites:1,vagas:1}],caracteristicas:['Piscina','Academia','Varanda'],fotos:['https://example.com/a.jpg','https://example.com/b.jpg'],plantas:[],descricao:'Imóvel de teste.'}}],
  votos:{0:'like'}
};

for (const [modelo, meta] of Object.entries(modelos)) {
  const entrada={...base,modelo};
  const cliente=clientPageV4(entrada);
  const corretor=resultPageV2(entrada);
  assert.match(cliente,/Camila/);
  assert.match(cliente,/Gostei/);
  assert.ok(cliente.toLowerCase().includes(meta.cor), `cliente ${meta.nome} deve aplicar a cor do modelo`);
  assert.ok(cliente.includes(`modelo-${modelo}`), `cliente ${meta.nome} deve carregar a classe visual do modelo`);
  assert.match(corretor,/Retorno/);
  assert.match(corretor,/José Arimateia/);
  assert.ok(corretor.toLowerCase().includes(meta.cor), `painel ${meta.nome} deve aplicar a cor do modelo`);
  assert.ok(corretor.includes(`modelo-${modelo}`), `painel ${meta.nome} deve carregar a classe visual do modelo`);
}

console.log('Visual smoke test: 4 modelos validados em cliente e painel.');
