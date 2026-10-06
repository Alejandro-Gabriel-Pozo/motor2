-- Un solo gerente por empresa, hecho cumplir por la base (informe de seguridad 2026-10-01, S-13; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR). Hasta
-- hoy la regla (decisión del dueño, 2026-09-30) vive solo en el código (`transferirGerencia`, `obtenerGerenteDeEmpresa`) y la migración de datos
-- 20261001120000 dejó el índice «para una fase posterior». Sin él, una carrera o un bug pueden dejar dos gerentes (la autoridad de empresa no se delega).
--
-- Índice único PARCIAL sobre `UsuarioEmpresa("empresaId") WHERE "rolEmpresa" = 'gerente'` (columna real: `rolEmpresa TEXT NULL`; el valor es el de
-- `ROL_EMPRESA_GERENTE`). A mano, como el de `MargenObjetivo`: Prisma no declara índices parciales. No filtra por `activo`: el gerente no se puede
-- desactivar (ver `actualizarActivoUsuarioEnEmpresa`), así que «uno por empresa» incluye al inactivo. No cambia `schema.prisma`.
-- `transferirGerencia` baja al actual ANTES de subir al nuevo (misma transacción): compatible con el índice.
--
-- Chequeo previo: si algún dato ya tiene dos gerentes en una empresa, la migración se detiene con el detalle (no normaliza sola: elegir cuál queda
-- es una decisión de negocio; la 20261001120000 ya dejó al más antiguo, así que solo pasa si alguien lo reintrodujo después). Reversa: down.sql.

DO $$
DECLARE
  repetidas text;
BEGIN
  SELECT string_agg(format('%s (%s gerentes)', "empresaId", n), ', ')
    INTO repetidas
    FROM (SELECT "empresaId", count(*) AS n FROM "UsuarioEmpresa" WHERE "rolEmpresa" = 'gerente' GROUP BY "empresaId" HAVING count(*) > 1) d;
  IF repetidas IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede crear el índice de gerente único: hay empresas con más de un gerente: %. Dejá uno por empresa (poné rolEmpresa = NULL en los demás) y volvé a migrar.', repetidas;
  END IF;
END
$$;

CREATE UNIQUE INDEX "UsuarioEmpresa_empresaId_gerente_key" ON "UsuarioEmpresa"("empresaId") WHERE "rolEmpresa" = 'gerente';
