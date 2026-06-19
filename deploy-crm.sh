#!/bin/bash
set -e

echo "→ Building CRM..."
cd /Users/camis/crm-imoveis
npm run build

echo "→ Copying to Railway frontend..."
rm -rf /Users/camis/PDF\ Imóveis/frontend/crm
cp -r build /Users/camis/PDF\ Imóveis/frontend/crm

echo "→ Committing and pushing..."
cd /Users/camis/PDF\ Imóveis
git add frontend/crm
git commit -m "Deploy CRM build $(date '+%d/%m/%Y %H:%M')"
git push

echo "✓ Deploy concluído!"
