-- Reversa de 20261112170000_nombre_unico_sin_mayusculas. No destructiva: solo saca los índices (no toca ningún dato). Idempotente.
-- Volver primero el código si hiciera falta y recién después correr esto, a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción).

DROP INDEX IF EXISTS "Cliente_empresaId_nombre_lower_key";
DROP INDEX IF EXISTS "SeccionCarta_empresaId_nombre_lower_key";
