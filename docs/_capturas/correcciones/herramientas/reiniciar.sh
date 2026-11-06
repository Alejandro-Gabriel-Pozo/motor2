#!/usr/bin/env bash
# MAQUETA: deja la base local descartable en el punto de partida (datos reales sembrados + la factura de CORDECC cargada por la pantalla de Compra).
set -euo pipefail
cd "$(dirname "$0")/../../../.."
set -a; . ./.env.cap; set +a
npx tsx docs/_capturas/correcciones/herramientas/sembrar-datos-reales.ts
npx tsx docs/_capturas/correcciones/herramientas/caso-compra.ts
