#!/usr/bin/env bash
# MAQUETA (rama temporal alegp/tmp-capturas-poda-codigo, no se mergea): entorno de la base local descartable motor2_e2e. Uso: source entorno.sh
export PGHOST=localhost PGUSER=motor2 PGPASSWORD=ci-duenio-descartable
export MOTOR2_E2E_DATABASE_URL=postgresql://motor2:ci-duenio-descartable@localhost:5432/motor2_e2e
export MOTOR2_E2E_APP_DATABASE_URL=postgresql://motor2_app:ci-app-descartable@localhost:5432/motor2_e2e
export MOTOR2_E2E_PRUEBAS_DATABASE_URL=postgresql://motor2_app_pruebas:ci-pruebas-descartable@localhost:5432/motor2_e2e
export DIRECT_URL=$MOTOR2_E2E_DATABASE_URL DATABASE_URL=$MOTOR2_E2E_APP_DATABASE_URL
export AUTH_SECRET=maqueta-secreto-local-descartable-0123456789abcdef AUTH_GOOGLE_ID=x AUTH_GOOGLE_SECRET=x AUTH_TRUST_HOST=1 AUTH_URL=http://localhost:3300 PORT=3300 MOTOR2_SIN_DOLAR_AUTOMATICO=1
