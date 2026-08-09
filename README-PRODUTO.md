# Produto v1 — transformação do gerador em SaaS

Esta branch concentra a evolução do gerador usado pelo Arimateia para uma primeira versão de produto multiusuário.

## Fluxo do corretor

1. Criar conta / entrar com e-mail e senha.
2. Configurar perfil profissional (nome, marca, CRECI, contatos, foto/logo por URL e cores).
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
- Plantas são tratadas separadamente e mantidas legíveis na compressão.
- Fotos são comprimidas antes da impressão para reduzir o arquivo final.

## Dados e fontes

- Órulo: consulta direta à API, incluindo tipologias, imagens e `floor_plans`. Não usa Claude nesse fluxo.
- Outras fontes: scraping + Claude para estruturar dados.
- O uso é medido por fonte (`orulo` ou `web_ai`) para orientar preço e limites depois do piloto.

## Banco

O produto usa Postgres via `DATABASE_URL` para usuários, perfis, sessões, apresentações, votos e medição de uso.

A camada antiga de Supabase permanece apenas como compatibilidade temporária para apresentações legadas. Contas novas exigem Postgres.

## Segurança

- A senha fixa do frontend foi removida da v1.
- Senhas de usuários são armazenadas com `scrypt` + salt.
- Sessões usam token aleatório, armazenado no banco apenas como hash SHA-256.
- Cookie de sessão é `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- O novo servidor não expõe `/debug-env` nem preview de chaves.
- O proxy de imagens bloqueia hosts locais/redes privadas.

## Ainda fora desta branch

- nome final e identidade do produto;
- página institucional;
- checkout/assinatura;
- limites comerciais por plano;
- subdomínio/domínio personalizado;
- upload próprio de foto e logo para storage;
- deploy de homologação e validação visual real do PDF.
