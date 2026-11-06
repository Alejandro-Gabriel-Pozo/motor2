#!/usr/bin/env bash
# MAQUETA: recorre los 4 casos de punta a punta sobre una base local descartable limpia (el servidor `npm run start:e2e` tiene que estar levantado en el puerto 3300).
set -euo pipefail
cd "$(dirname "$0")/../../../.."
set -a; . ./.env.cap; set +a
H=docs/_capturas/correcciones/herramientas
$H/reiniciar.sh
npx tsx $H/caso-pos.ts mesa
npx tsx $H/caso-pos.ts mostrador
npx tsx $H/caso-compra-contenedor.ts
npx tsx $H/caso-nc.ts
