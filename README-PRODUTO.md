# Produto v1 — transformação do gerador em SaaS

Esta branch concentra a evolução do gerador usado pelo Arimateia para uma primeira versão de produto multiusuário.

## Fluxo do corretor

1. Criar conta / entrar com e-mail e senha.
2. Configurar perfil profissional: nome, marca, CRECI, contatos, foto/logo por URL e cores.
3. Colar URLs de imóveis.
4. Revisar as mídias encontradas.
5. Selecionar até 12 visuais por imóvel e definir 2 fotos hero.
6. Escolher um dos 4 modelos: Editorial, Clean, Bold ou Minimal.
7. Ver a prévia.
8. Gerar PDF otimizado para WhatsApp ou link para o cliente.
9. Acompanhar o histórico e as avaliações dos clientes.

## PDF

- A primeira página junta contexto, corretor, cliente e comparativo.
- Não existe capa separada.
- Cada imóvel usa no máximo 2 páginas.
- Até 12 elementos visuais por imóvel.
- 2 fotos hero lado a lado.
- Plantas são tratadas separadamente e recebem compressão mais conservadora.
- Fotos são comprimidas antes da impressão para reduzir o arquivo final.
- A descrição do PDF é resumida para proteger a paginação; o link mantém a descrição completa.
- O comparativo mostra até 20 imóveis na abertura e sinaliza quando existem opções adicionais.

## Dados e fontes

- Órulo no piloto: consulta dados, tipologias, imagens e `floor_plans` a partir do link compartilhado, somente quando `ORULO_SHARE_LINKS_ENABLED=true`.
- Produto comercial: a integração com Órulo deve usar credenciais/fluxo oficial contratado. O modo de link compartilhado não é a arquitetura de lançamento.
- Outras fontes: scraping + Claude para estruturar dados, sujeito à compatibilidade e às regras de cada origem.
- O uso é medido por fonte (`orulo` ou `web_ai`). Para chamadas com IA são registrados também input/output tokens reais.

## Banco

O produto usa Postgres via `DATABASE_URL` para usuários, perfis, sessões, apresentações, votos e medição de uso.

A camada antiga de Supabase permanece apenas como compatibilidade temporária para apresentações legadas. Contas novas exigem Postgres.

## Segurança e isolamento

- A senha fixa do frontend foi removida da v1.
- Senhas de usuários são armazenadas com `scrypt` + salt.
- Sessões usam token aleatório, armazenado no banco apenas como hash SHA-256.
- Cookie de sessão é `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- Apresentações e histórico são associados ao usuário.
- O link `/ver/:id` é público para o cliente.
- O resultado `/resultado/:id` exige login e só abre para o dono da apresentação.
- IDs de apresentação têm 16 caracteres.
- A avaliação do cliente só pode ser enviada uma vez.
- O novo servidor não expõe `/debug-env` nem preview de chaves.
- O proxy de imagens bloqueia hosts locais/redes privadas.

## Testes automáticos

O GitHub Actions sobe um Postgres real e executa um smoke test cobrindo:

- criar conta e login;
- salvar perfil;
- salvar apresentação;
- histórico por usuário;
- link público do cliente;
- resultado privado do corretor;
- like do cliente e bloqueio de sobrescrita;
- isolamento entre duas contas.

## O que falta antes da homologação visual

- configurar um Postgres real e a `DATABASE_URL` no ambiente de homologação;
- configurar a chave da Anthropic;
- habilitar `ORULO_SHARE_LINKS_ENABLED=true` somente no ambiente de piloto do Arimateia;
- fazer deploy da branch em URL separada da produção atual;
- validar visualmente os 4 modelos com links reais;
- medir o tamanho real dos PDFs após a nova compressão;
- confirmar que as plantas do exemplo real chegam e ficam legíveis.

## Depois da homologação do núcleo

- nome final e identidade do produto;
- página institucional;
- checkout/assinatura;
- limites comerciais por plano com base no uso medido;
- domínio principal do produto, subdomínio do corretor e domínio personalizado no plano adequado;
- upload próprio de foto e logo para storage;
- integração oficial com Órulo para lançamento comercial.
