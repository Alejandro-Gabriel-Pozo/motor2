-- Caja y cobro, etapa C1b «Estado EN_CIERRE de la sesión de caja» (docs/diseno-caja-c1b-en-cierre-2026-11-16.md). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar). Decisión del dueño del 2026-11-16: «Frenar el cobro, como Pedernal (Recomendada)».
--
-- QUÉ: la sesión de caja pasa por ABIERTA → EN_CIERRE → CERRADA (C1 la cerraba en un solo paso). Mientras está EN_CIERRE no entra ningún movimiento ni cobro; el conteo (arqueo y billetes) se escribe SOLO durante el cierre.
-- ADITIVA: dos columnas NULAS en `SesionCaja` (`cierreIniciadoEn`, `cierreIniciadoPorId`, FK a `User`); ninguna fila existente cambia; el código anterior (que solo conoce ABIERTA y CERRADA) sigue andando
-- sobre las filas que ya hay. Sin tablas nuevas, sin políticas nuevas (las de empresa y sucursal de SesionCaja ya cubren las columnas).
--
-- QUÉ REEMPLAZA (la menor cantidad posible; el resto de las funciones de C1 queda como está):
--   * REEMPLAZA `"SesionCaja_validar"()` (cuerpo de 20261117110000_caja_c1): la rama de UPDATE pasa de «solo ABIERTA → CERRADA» a las tres transiciones ABIERTA → EN_CIERRE, EN_CIERRE → ABIERTA y EN_CIERRE → CERRADA (la CERRADA no se toca);
--     y al cerrar, quién y cuándo inició el cierre no cambia. La rama de INSERT es idéntica.
--   * REEMPLAZA `"Arqueo_validar"()`: el arqueo y los billetes entran solo con la sesión EN_CIERRE (antes: ABIERTA), llamando a la función nueva de abajo.
--   * AGREGA `"SesionCaja_exigir_en_cierre"(text, uuid, text)`, gemela de `"SesionCaja_exigir_abierta"` (mismo FOR SHARE, mismas barreras) pero exige EN_CIERRE.
--   * NO TOCA `"SesionCaja_exigir_abierta"`, `"MovimientoCaja_validar"` ni `"Cobranza_validar"`: ya exigían ABIERTA, así que con la sesión EN_CIERRE rechazan solos movimientos y cobros (`sesion_caja_no_abierta`).
--   * NO TOCA `"SesionCaja_verificar_cierre"`: sigue recalculando lo esperado al confirmar (diferido) cuando el estado nuevo es CERRADA.
--   * CAMBIA los CHECK `SesionCaja_estado_chk` (suma EN_CIERRE) y `SesionCaja_marcas_chk` (ABIERTA: sin marcas; EN_CIERRE: cierre iniciado y sin cierre; CERRADA: cerrada con su persona). El índice único parcial
--     `SesionCaja_una_sin_cerrar_por_caja_key` (WHERE "estado" <> 'CERRADA') ya cubre EN_CIERRE: no se toca.
--   * Privilegio: UPDATE por columna sobre las dos columnas nuevas (la app sigue sin DELETE).
-- Si otra etapa (C2, C3) también reemplaza alguna de estas funciones, se fusionan al integrar: esta migración no se adapta a ellas.
--
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117119000_caja_c1b_en_cierre`). ABORTA si hay sesiones EN_CIERRE.

-- ===== Columnas nuevas (nulas) =====
ALTER TABLE "SesionCaja" ADD COLUMN "cierreIniciadoEn" TIMESTAMPTZ(3);
ALTER TABLE "SesionCaja" ADD COLUMN "cierreIniciadoPorId" TEXT;
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_cierreIniciadoPorId_fkey" FOREIGN KEY ("cierreIniciadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Estados y marcas =====
ALTER TABLE "SesionCaja" DROP CONSTRAINT "SesionCaja_estado_chk";
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_estado_chk" CHECK ("estado" IN ('ABIERTA', 'EN_CIERRE', 'CERRADA'));
ALTER TABLE "SesionCaja" DROP CONSTRAINT "SesionCaja_marcas_chk";
-- El estado manda sobre las marcas. La CERRADA admite cierre iniciado nulo (las cerradas en un solo paso de C1) pero nunca a medias (en y por van juntos).
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_marcas_chk" CHECK (
  ("estado" = 'ABIERTA' AND "cierreIniciadoEn" IS NULL AND "cierreIniciadoPorId" IS NULL AND "cerradaEn" IS NULL AND "cerradaPorId" IS NULL AND "observacion" IS NULL)
  OR ("estado" = 'EN_CIERRE' AND "cierreIniciadoEn" IS NOT NULL AND "cierreIniciadoPorId" IS NOT NULL AND "cerradaEn" IS NULL AND "cerradaPorId" IS NULL AND "observacion" IS NULL)
  OR ("estado" = 'CERRADA' AND "cerradaEn" IS NOT NULL AND "cerradaPorId" IS NOT NULL AND ("cierreIniciadoEn" IS NULL) = ("cierreIniciadoPorId" IS NULL)));

-- ===== Transiciones =====
-- Solo ABIERTA → EN_CIERRE, EN_CIERRE → ABIERTA (cancelar el cierre) y EN_CIERRE → CERRADA. Cualquier otra, incluido ABIERTA → CERRADA directo y quedarse en el mismo estado, es inválida; la CERRADA es inmutable.
CREATE OR REPLACE FUNCTION "SesionCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sucursal text; v_activa boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."estado" <> 'ABIERTA' THEN RAISE EXCEPTION 'sesion_caja_nace_abierta' USING ERRCODE = '23514'; END IF;
    SELECT c."sucursalId" INTO v_sucursal FROM "Caja" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cajaId";
    IF v_sucursal IS DISTINCT FROM NEW."sucursalId" THEN RAISE EXCEPTION 'sesion_caja_de_otra_sucursal' USING ERRCODE = '23514'; END IF;
    SELECT s."activo" INTO v_activa FROM "Sucursal" s WHERE s."empresaId" = NEW."empresaId" AND s."id" = NEW."sucursalId";
    IF v_activa IS NOT TRUE THEN RAISE EXCEPTION 'sesion_caja_sucursal_inactiva' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."estado" = 'CERRADA' THEN RAISE EXCEPTION 'sesion_caja_cerrada_no_se_toca' USING ERRCODE = '23514'; END IF;
  IF NOT ((OLD."estado" = 'ABIERTA' AND NEW."estado" = 'EN_CIERRE') OR (OLD."estado" = 'EN_CIERRE' AND NEW."estado" IN ('ABIERTA', 'CERRADA'))) THEN
    RAISE EXCEPTION 'sesion_caja_transicion_invalida' USING ERRCODE = '23514';
  END IF;
  IF OLD."estado" = 'EN_CIERRE' AND NEW."estado" = 'CERRADA'
     AND (NEW."cierreIniciadoEn" IS DISTINCT FROM OLD."cierreIniciadoEn" OR NEW."cierreIniciadoPorId" IS DISTINCT FROM OLD."cierreIniciadoPorId") THEN
    RAISE EXCEPTION 'sesion_caja_al_cerrar_no_cambia_quien_inicio_el_cierre' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- ===== Conteo solo durante el cierre =====
-- Gemela de "SesionCaja_exigir_abierta": la fila que cuelga de una sesión por el CONTEO (arqueo, billetes) entra SOLO con la sesión EN_CIERRE y de su misma sucursal. FOR SHARE: un cierre o una cancelación concurrentes esperan o chocan.
CREATE FUNCTION "SesionCaja_exigir_en_cierre"(p_empresa text, p_sesion uuid, p_sucursal text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_sucursal text;
BEGIN
  SELECT s."estado", s."sucursalId" INTO v_estado, v_sucursal FROM "SesionCaja" s WHERE s."empresaId" = p_empresa AND s."id" = p_sesion FOR SHARE;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'sesion_caja_inexistente' USING ERRCODE = '23503'; END IF;
  IF v_estado <> 'EN_CIERRE' THEN RAISE EXCEPTION 'sesion_caja_no_en_cierre' USING ERRCODE = '23514'; END IF;
  IF v_sucursal <> p_sucursal THEN RAISE EXCEPTION 'fila_de_otra_sucursal_que_su_sesion' USING ERRCODE = '23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION "Arqueo_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "SesionCaja_exigir_en_cierre"(NEW."empresaId", NEW."sesionId", NEW."sucursalId");
  RETURN NEW;
END $$;

-- ===== Privilegios (si el rol existe): las dos columnas nuevas se escriben al iniciar y al cancelar el cierre. =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE ("cierreIniciadoEn", "cierreIniciadoPorId") ON "SesionCaja" TO motor2_app;
  END IF;
END
$$;
