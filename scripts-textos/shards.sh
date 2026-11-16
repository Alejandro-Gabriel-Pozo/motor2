#!/bin/bash
# Corre Vitest en 4 partes, cada una con su copia de la base (motor2_s1..4, creadas con createdb -T motor2_dev). Uso: shards.sh <raiz-del-repo>
cd "${1:-/home/user/motor2}"
export NODE_OPTIONS=--max-old-space-size=4096 AUTH_SECRET=ci-auth-secret-de-relleno-0123456789abcdef AUTH_GOOGLE_ID=ci-google-id AUTH_GOOGLE_SECRET=ci-google-secret
for i in 1 2 3 4; do
 (
  B=motor2_s$i
  export DIRECT_URL=postgresql://motor2:ci-duenio-descartable@localhost:5432/$B DATABASE_URL=postgresql://motor2_app:ci-app-descartable@localhost:5432/$B MOTOR2_PRUEBAS_DATABASE_URL=postgresql://motor2_app_pruebas:ci-pruebas-descartable@localhost:5432/$B PLATAFORMA_DATABASE_URL=postgresql://motor2_plataforma:ci-plataforma-descartable@localhost:5432/$B
  npx vitest run --shard=$i/4 > /tmp/shard$i.log 2>&1
  echo "shard $i exit $?" >> /tmp/shards.done
 ) &
done
wait
