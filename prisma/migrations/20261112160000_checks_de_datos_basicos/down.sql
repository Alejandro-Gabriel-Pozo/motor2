-- Reversa de 20261112160000_checks_de_datos_basicos. No destructiva: solo saca las reglas (no toca ningún dato). Idempotente.
-- Volver primero el código si hiciera falta y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

ALTER TABLE "Empresa" DROP CONSTRAINT IF EXISTS "Empresa_moneda_chk";
ALTER TABLE "CotizacionDolar" DROP CONSTRAINT IF EXISTS "CotizacionDolar_fuente_chk";
ALTER TABLE "Cliente" DROP CONSTRAINT IF EXISTS "Cliente_descuentoPorcentaje_chk";
