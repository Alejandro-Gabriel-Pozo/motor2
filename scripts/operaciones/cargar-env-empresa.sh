#!/usr/bin/env bash
# Producción de la empresa que trabaja sola (proyecto Vercel `stockhneuquen`).
#   bash scripts/operaciones/cargar-env-empresa.sh --plantilla    crea .env.vercel.empresa (valores vacíos)
#   bash scripts/operaciones/cargar-env-empresa.sh                ensayo
#   bash scripts/operaciones/cargar-env-empresa.sh --ejecutar     carga
# Detalles y reglas: scripts/operaciones/cargar-env-vercel.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
bash scripts/operaciones/cargar-env-vercel.sh stockhneuquen .env.vercel.empresa "${1:-ensayo}"
