#!/usr/bin/env bash
# Construye "antes" (origin/main) en un worktree y "después" (esta rama) y saca la misma captura de cada uno.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../../../.." && pwd)"; cd "$RAIZ"
source docs/_capturas/poda-codigo/herramientas/entorno.sh
ANTES=/tmp/claude-0/antes-poda; rm -rf $ANTES; git worktree add -f --detach $ANTES origin/main >/dev/null; ln -s "$RAIZ/node_modules" $ANTES/node_modules
for par in "$ANTES:3300:01-perfil-empresa-ANTES-celular" "$RAIZ:3301:02-perfil-empresa-DESPUES-celular"; do
  IFS=: read -r DIR PUERTO NOM <<<"$par"
  (cd "$DIR" && npm run build:e2e >/tmp/claude-0/build-$PUERTO.log 2>&1 && PORT=$PUERTO AUTH_URL=http://localhost:$PUERTO npx next start -p $PUERTO >/tmp/claude-0/start-$PUERTO.log 2>&1 &)
  until curl -s -o /dev/null http://localhost:$PUERTO/login; do sleep 3; done
  npx tsx docs/_capturas/poda-codigo/herramientas/capturar.ts $PUERTO "$NOM"
  pkill -f "next start -p $PUERTO" || true; pkill -f "next-server" || true
done
git worktree remove --force $ANTES
echo LISTO
