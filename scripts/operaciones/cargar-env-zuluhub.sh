#!/usr/bin/env bash
# Producción de la plataforma ZuluHub (proyecto Vercel `motor2-demo`: carta pública por subdominio, varias empresas).
#   bash scripts/operaciones/cargar-env-zuluhub.sh --plantilla    crea .env.vercel.zuluhub (valores vacíos)
#   bash scripts/operaciones/cargar-env-zuluhub.sh                ensayo
#   bash scripts/operaciones/cargar-env-zuluhub.sh --ejecutar     carga
# Detalles y reglas: scripts/operaciones/cargar-env-vercel.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
bash scripts/operaciones/cargar-env-vercel.sh motor2-demo .env.vercel.zuluhub "${1:-ensayo}"
