-- Caja y cobro, etapa C2 «Jornada de sucursal y cierre del día» (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md), como la decidió Pedernal (0026_cierre.sql y 0027_caja.sql). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar). Pedido del dueño (2026-11-16): «Caja: cierre del día y cuenta de cobro» «como las decidió Pedernal, una por vez, en local y sin aplicar nada a ninguna base».
--
-- QUÉ: CINCO tablas nuevas (`JornadaDeSucursal`, `ControlDeJornadaCerrada`, `CorreccionDeMedio`, `DeclaracionDeTotal`, `ConformeDeJornada`); TRES columnas nuevas con valor por defecto constante (`Sucursal.horaDeCorte`, `SesionCaja.horaDeCorte`, `MovimientoCaja.corrigeJornada`);
-- la función `caja_fecha_de_negocio`; y la ampliación de reglas de C1: la clase AJUSTE en `MovimientoCaja` (CHECK de clase, signo y motivo) y los disparadores de `SesionCaja` y `MovimientoCaja` (sello de la sesión, jornada abierta, ajuste a una jornada cerrada).
-- Compatibilidad: el código de C1 no lee ni escribe lo nuevo; las columnas nuevas tienen valor por defecto (00:00, el corte que C1 ya usaba). Las sesiones que ya existieran reciben su jornada ABIERTA (al final, idempotente). Índices sin CONCURRENTLY (tablas nuevas y vacías).
--
-- MOLDE (docs/diseno-datos-paridad-pedernal-2026-11-16.md, E-0): `id` UUID nativo que genera la app; instantes TIMESTAMPTZ(3); la app NO tiene DELETE ni TRUNCATE en ninguna; historial que solo agrega (UPDATE solo por columna y solo donde hace falta: el cambio de estado de la jornada);
-- clave de reintento en los comandos que crean filas. Dinero NUMERIC(14,2) en pesos.
--
-- QUÉ DECIDE LA BASE (no depende de que el caso de uso se acuerde): la fecha de negocio de la sesión es la de la fórmula `((abiertaEn AT TIME ZONE zona) - corte)::date` con la zona de la empresa y el corte de la sucursal; la sesión solo se abre con su jornada ABIERTA; un movimiento solo entra con la jornada de su sesión
-- ABIERTA; la jornada solo cambia ABIERTA → EN_AUDITORIA, EN_AUDITORIA → ABIERTA y EN_AUDITORIA → CERRADA, y CERRADA no se toca; la foto de controles solo entra con la jornada pasando a CERRADA en la misma transacción; corregir medio, declarar total y dar el conforme solo con la jornada EN_AUDITORIA;
-- la secuencia de correcciones y de declaraciones sigue sin huecos y la corrección parte del medio vigente; el efectivo no se declara; un AJUSTE que corrige una jornada exige que exista, esté CERRADA y sea anterior a la de su sesión.
-- QUÉ DECIDE EL CASO DE USO: permisos (quién ajusta), alcance, la huella de los controles y su comparación, qué se reconoce, la clave de reintento y la auditoría. La base NO sabe qué controles aportan los módulos.
-- Las políticas de alcance de sucursal (RLS por sucursal) van en la migración siguiente (20261117115000), salida exacta del generador.
--
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117114000_caja_c2_jornada`). Bajar ANTES la de políticas (20261117115000).
-- La reversa ABORTA si hay una jornada en cierre o cerrada, filas en las otras cuatro tablas, un AJUSTE o una hora de corte distinta de 00:00 (se perdería lo que decidió una persona).

DO $$
BEGIN
  IF to_regclass('"SesionCaja"') IS NULL OR to_regclass('"MovimientoCaja"') IS NULL OR to_regclass('"Cobro"') IS NULL OR to_regclass('"MedioDePago"') IS NULL THEN
    RAISE EXCEPTION 'caja C2 requiere 20261117110000_caja_c1 aplicada antes' USING ERRCODE = '55000';
  END IF;
END
$$;

-- ===== Columnas nuevas =====

-- La hora de corte de cada sucursal (como Pedernal 0007): minutos exactos, menor que 24:00. Valor por defecto constante: no reescribe la tabla.
ALTER TABLE "Sucursal" ADD COLUMN "horaDeCorte" TIME(0) NOT NULL DEFAULT '00:00:00';
ALTER TABLE "Sucursal" ADD CONSTRAINT "Sucursal_horaDeCorte_chk" CHECK ("horaDeCorte" < time '24:00' AND extract(second FROM "horaDeCorte") = 0);

-- El sello de la sesión: junto con la fecha y la zona. Las sesiones de C1 se abrieron con corte 00:00.
ALTER TABLE "SesionCaja" ADD COLUMN "horaDeCorte" TIME(0) NOT NULL DEFAULT '00:00:00';
ALTER TABLE "SesionCaja" ADD CONSTRAINT "SesionCaja_horaDeCorte_chk" CHECK ("horaDeCorte" < time '24:00' AND extract(second FROM "horaDeCorte") = 0);

-- La jornada cerrada que un AJUSTE explica.
ALTER TABLE "MovimientoCaja" ADD COLUMN "corrigeJornada" DATE;

-- ===== AJUSTE: ampliación de las reglas de MovimientoCaja =====
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT "MovimientoCaja_clase_chk";
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_clase_chk" CHECK ("clase" IN ('FONDO_INICIAL', 'COBRO', 'INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE', 'ANULACION'));
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT "MovimientoCaja_signo_chk";
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_signo_chk" CHECK (
  ("clase" = 'FONDO_INICIAL' AND "importe" >= 0)
  OR ("clase" IN ('COBRO', 'INGRESO_MANUAL') AND "importe" > 0)
  OR ("clase" = 'EGRESO_MANUAL' AND "importe" < 0)
  OR ("clase" IN ('AJUSTE', 'ANULACION') AND "importe" <> 0));
ALTER TABLE "MovimientoCaja" DROP CONSTRAINT "MovimientoCaja_motivo_chk";
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_motivo_chk" CHECK (
  ("clase" IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE', 'ANULACION') AND "motivo" IS NOT NULL AND char_length("motivo") BETWEEN 1 AND 500)
  OR ("clase" IN ('FONDO_INICIAL', 'COBRO') AND "motivo" IS NULL));
-- Solo un AJUSTE puede explicar una jornada cerrada.
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_corrige_chk" CHECK ("corrigeJornada" IS NULL OR "clase" = 'AJUSTE');

-- ===== La fecha de negocio: la fórmula de Pedernal, en la base =====
CREATE FUNCTION caja_fecha_de_negocio(p_instante timestamptz, p_zona text, p_corte time) RETURNS date LANGUAGE sql STABLE AS
$$ SELECT ((p_instante AT TIME ZONE p_zona) - p_corte::interval)::date $$;

-- CreateTable
CREATE TABLE "JornadaDeSucursal" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "fechaDeNegocio" DATE NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTA',
    "auditoriaIniciadaEn" TIMESTAMPTZ(3),
    "auditoriaIniciadaPorId" TEXT,
    "cerradaEn" TIMESTAMPTZ(3),
    "cerradaPorId" TEXT,
    "huellaDeCierre" TEXT,
    "observacion" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JornadaDeSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlDeJornadaCerrada" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "jornadaId" UUID NOT NULL,
    "modulo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "severidad" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "reconocido" BOOLEAN NOT NULL,
    "reconocidoEn" TIMESTAMPTZ(3),
    "reconocidoPorId" TEXT,
    "texto" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlDeJornadaCerrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorreccionDeMedio" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "jornadaId" UUID NOT NULL,
    "cobroId" UUID NOT NULL,
    "secuencia" INTEGER NOT NULL,
    "medioAntesId" UUID NOT NULL,
    "medioDespuesId" UUID NOT NULL,
    "motivo" TEXT NOT NULL,
    "corregidoEn" TIMESTAMPTZ(3) NOT NULL,
    "corregidoPorId" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorreccionDeMedio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclaracionDeTotal" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "jornadaId" UUID NOT NULL,
    "medioDePagoId" UUID NOT NULL,
    "secuencia" INTEGER NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,
    "declaradoEn" TIMESTAMPTZ(3) NOT NULL,
    "declaradoPorId" TEXT NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclaracionDeTotal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConformeDeJornada" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "jornadaId" UUID NOT NULL,
    "conformePorId" TEXT NOT NULL,
    "conformeEn" TIMESTAMPTZ(3) NOT NULL,
    "claveIdempotencia" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConformeDeJornada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JornadaDeSucursal_empresaId_id_key" ON "JornadaDeSucursal"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JornadaDeSucursal_una_por_dia_key" ON "JornadaDeSucursal"("empresaId", "sucursalId", "fechaDeNegocio");

-- CreateIndex
CREATE UNIQUE INDEX "ControlDeJornadaCerrada_empresaId_id_key" ON "ControlDeJornadaCerrada"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ControlDeJornadaCerrada_empresaId_jornadaId_clave_key" ON "ControlDeJornadaCerrada"("empresaId", "jornadaId", "clave");

-- CreateIndex
CREATE INDEX "CorreccionDeMedio_jornadaId_idx" ON "CorreccionDeMedio"("jornadaId");

-- CreateIndex
CREATE UNIQUE INDEX "CorreccionDeMedio_empresaId_id_key" ON "CorreccionDeMedio"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CorreccionDeMedio_empresaId_cobroId_secuencia_key" ON "CorreccionDeMedio"("empresaId", "cobroId", "secuencia");

-- CreateIndex
CREATE UNIQUE INDEX "CorreccionDeMedio_empresaId_claveIdempotencia_key" ON "CorreccionDeMedio"("empresaId", "claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "DeclaracionDeTotal_empresaId_id_key" ON "DeclaracionDeTotal"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeclaracionDeTotal_empresaId_jornadaId_medioDePagoId_secuencia_key" ON "DeclaracionDeTotal"("empresaId", "jornadaId", "medioDePagoId", "secuencia");

-- CreateIndex
CREATE UNIQUE INDEX "DeclaracionDeTotal_empresaId_claveIdempotencia_key" ON "DeclaracionDeTotal"("empresaId", "claveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "ConformeDeJornada_empresaId_id_key" ON "ConformeDeJornada"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConformeDeJornada_empresaId_jornadaId_key" ON "ConformeDeJornada"("empresaId", "jornadaId");

-- CreateIndex
CREATE UNIQUE INDEX "ConformeDeJornada_empresaId_claveIdempotencia_key" ON "ConformeDeJornada"("empresaId", "claveIdempotencia");

-- AddForeignKey
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_auditoriaIniciadaPorId_fkey" FOREIGN KEY ("auditoriaIniciadaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_cerradaPorId_fkey" FOREIGN KEY ("cerradaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_empresaId_jornadaId_fkey" FOREIGN KEY ("empresaId", "jornadaId") REFERENCES "JornadaDeSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_reconocidoPorId_fkey" FOREIGN KEY ("reconocidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_empresaId_jornadaId_fkey" FOREIGN KEY ("empresaId", "jornadaId") REFERENCES "JornadaDeSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_empresaId_cobroId_fkey" FOREIGN KEY ("empresaId", "cobroId") REFERENCES "Cobro"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_empresaId_medioAntesId_fkey" FOREIGN KEY ("empresaId", "medioAntesId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_empresaId_medioDespuesId_fkey" FOREIGN KEY ("empresaId", "medioDespuesId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_corregidoPorId_fkey" FOREIGN KEY ("corregidoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_empresaId_jornadaId_fkey" FOREIGN KEY ("empresaId", "jornadaId") REFERENCES "JornadaDeSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_empresaId_medioDePagoId_fkey" FOREIGN KEY ("empresaId", "medioDePagoId") REFERENCES "MedioDePago"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_declaradoPorId_fkey" FOREIGN KEY ("declaradoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConformeDeJornada" ADD CONSTRAINT "ConformeDeJornada_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConformeDeJornada" ADD CONSTRAINT "ConformeDeJornada_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConformeDeJornada" ADD CONSTRAINT "ConformeDeJornada_empresaId_jornadaId_fkey" FOREIGN KEY ("empresaId", "jornadaId") REFERENCES "JornadaDeSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConformeDeJornada" ADD CONSTRAINT "ConformeDeJornada_conformePorId_fkey" FOREIGN KEY ("conformePorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Reglas que Prisma no modela (a mano) =====

-- JornadaDeSucursal. El estado manda sobre las marcas (J3 de Pedernal): ABIERTA ⇔ sin inicio de auditoría; CERRADA ⇔ con cierre; cada marca va con su persona y la huella con el cierre.
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_estado_chk" CHECK ("estado" IN ('ABIERTA', 'EN_AUDITORIA', 'CERRADA'));
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_fecha_chk" CHECK ("fechaDeNegocio" BETWEEN date '2000-01-01' AND date '2200-12-31');
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_marcas_chk" CHECK (
  ("estado" = 'ABIERTA') = ("auditoriaIniciadaEn" IS NULL)
  AND ("estado" = 'CERRADA') = ("cerradaEn" IS NOT NULL)
  AND ("auditoriaIniciadaEn" IS NULL) = ("auditoriaIniciadaPorId" IS NULL)
  AND ("cerradaEn" IS NULL) = ("cerradaPorId" IS NULL)
  AND ("cerradaEn" IS NULL) = ("huellaDeCierre" IS NULL)
  AND ("cerradaEn" IS NULL OR "cerradaEn" >= "auditoriaIniciadaEn"));
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_huella_chk" CHECK ("huellaDeCierre" IS NULL OR "huellaDeCierre" ~ '^[0-9a-f]{64}$');
-- Opcional y solo al cerrar: una línea de 1 a 500 caracteres de la LISTA DE PERMITIDOS de la explicación (src/core/caja/explicacion.ts), sin blancos en los extremos.
ALTER TABLE "JornadaDeSucursal" ADD CONSTRAINT "JornadaDeSucursal_observacion_chk" CHECK (
  "observacion" IS NULL OR (
    "estado" = 'CERRADA' AND "observacion" = btrim("observacion") AND char_length("observacion") <= 500
    AND "observacion" ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'));

-- ControlDeJornadaCerrada
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_modulo_chk" CHECK ("modulo" ~ '^[a-z_]+$' AND char_length("modulo") <= 40);
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_clave_chk" CHECK (
  "clave" ~ '^[a-z_]+\.[a-z_]+$' AND char_length("clave") <= 81 AND left("clave", char_length("modulo") + 1) = "modulo" || '.');
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_severidad_chk" CHECK ("severidad" IN ('BLOQUEA', 'RECONOCIBLE', 'INFORMA'));
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_cantidad_chk" CHECK ("cantidad" >= 0);
-- Reconocido ⇒ por y en, y solo un control RECONOCIBLE con hallazgos se reconoce (constancia de quién y cuándo).
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_reconocido_chk" CHECK (
  "reconocido" = ("reconocidoPorId" IS NOT NULL AND "reconocidoEn" IS NOT NULL)
  AND ("reconocidoPorId" IS NULL) = ("reconocidoEn" IS NULL)
  AND (NOT "reconocido" OR ("severidad" = 'RECONOCIBLE' AND "cantidad" > 0)));
ALTER TABLE "ControlDeJornadaCerrada" ADD CONSTRAINT "ControlDeJornadaCerrada_texto_chk" CHECK (
  "texto" IS NULL OR (
    "reconocido" AND "texto" = btrim("texto") AND char_length("texto") <= 500
    AND "texto" ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$'));

-- CorreccionDeMedio
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_secuencia_chk" CHECK ("secuencia" >= 1);
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_cambia_chk" CHECK ("medioAntesId" <> "medioDespuesId");
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_motivo_chk" CHECK (
  "motivo" = btrim("motivo") AND char_length("motivo") BETWEEN 1 AND 500
  AND "motivo" ~ '^[A-Za-zÀ-ÖØ-öø-ÿ0-9 .,;:!?¿¡()/%$#&''"°ºª+*_-]+$');
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_clave_chk" CHECK ("claveIdempotencia" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
ALTER TABLE "CorreccionDeMedio" ADD CONSTRAINT "CorreccionDeMedio_huella_chk" CHECK ("huella" ~ '^[0-9a-f]{64}$');

-- DeclaracionDeTotal
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_secuencia_chk" CHECK ("secuencia" >= 1);
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_importe_chk" CHECK ("importe" >= 0);
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_clave_chk" CHECK ("claveIdempotencia" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
ALTER TABLE "DeclaracionDeTotal" ADD CONSTRAINT "DeclaracionDeTotal_huella_chk" CHECK ("huella" ~ '^[0-9a-f]{64}$');

-- ConformeDeJornada
ALTER TABLE "ConformeDeJornada" ADD CONSTRAINT "ConformeDeJornada_clave_chk" CHECK ("claveIdempotencia" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
ALTER TABLE "ConformeDeJornada" ADD CONSTRAINT "ConformeDeJornada_huella_chk" CHECK ("huella" ~ '^[0-9a-f]{64}$');

-- ===== Disparadores =====

-- JornadaDeSucursal: la identidad no cambia; CERRADA no admite NINGÚN cambio; las transiciones son exactamente tres (J2 de Pedernal). Quién inicia y quién cierra lo pone el caso de uso (la base de Motor2 no sabe quién es la persona).
CREATE FUNCTION "JornadaDeSucursal_validar_cambio"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."empresaId" IS DISTINCT FROM OLD."empresaId" OR NEW."sucursalId" IS DISTINCT FROM OLD."sucursalId"
     OR NEW."fechaDeNegocio" IS DISTINCT FROM OLD."fechaDeNegocio" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'jornada_identidad_inmutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."estado" = 'CERRADA' THEN RAISE EXCEPTION 'jornada_cerrada_congelada' USING ERRCODE = '23514'; END IF;
  IF OLD."estado" = 'ABIERTA' AND NEW."estado" = 'EN_AUDITORIA' THEN
    IF NEW."cerradaEn" IS NOT NULL OR NEW."cerradaPorId" IS NOT NULL OR NEW."huellaDeCierre" IS NOT NULL OR NEW."observacion" IS NOT NULL THEN
      RAISE EXCEPTION 'jornada_transicion_invalida' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."estado" = 'EN_AUDITORIA' AND NEW."estado" = 'ABIERTA' THEN
    NULL; -- cancelar: vuelve sin marcas (lo exige el CHECK `JornadaDeSucursal_marcas_chk`); el rastro queda en RegistroAuditoria.
  ELSIF OLD."estado" = 'EN_AUDITORIA' AND NEW."estado" = 'CERRADA' THEN
    IF NEW."auditoriaIniciadaEn" IS DISTINCT FROM OLD."auditoriaIniciadaEn" OR NEW."auditoriaIniciadaPorId" IS DISTINCT FROM OLD."auditoriaIniciadaPorId" THEN
      RAISE EXCEPTION 'jornada_transicion_invalida' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'jornada_transicion_invalida' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JornadaDeSucursal_validar_cambio" BEFORE UPDATE ON "JornadaDeSucursal" FOR EACH ROW EXECUTE FUNCTION "JornadaDeSucursal_validar_cambio"();

-- La jornada de una fila que cuelga de ella (control, corrección, declaración, conforme): existe, es de la misma sucursal y está en el estado que la regla pide. FOR SHARE: quien cierra (FOR UPDATE) espera a los que están en vuelo y los que llegan después la encuentran cerrada.
CREATE FUNCTION "JornadaDeSucursal_exigir_estado"(p_empresa text, p_jornada uuid, p_sucursal text, p_estado text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_estado text; v_sucursal text;
BEGIN
  SELECT j."estado", j."sucursalId" INTO v_estado, v_sucursal FROM "JornadaDeSucursal" j WHERE j."empresaId" = p_empresa AND j."id" = p_jornada FOR SHARE;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'jornada_inexistente' USING ERRCODE = '23503'; END IF;
  IF v_sucursal <> p_sucursal THEN RAISE EXCEPTION 'fila_de_otra_sucursal_que_su_jornada' USING ERRCODE = '23514'; END IF;
  IF v_estado <> p_estado THEN RAISE EXCEPTION 'jornada_no_esta_en_%', lower(p_estado) USING ERRCODE = '23514'; END IF;
END $$;

-- La foto de controles solo entra con la jornada pasando a CERRADA en ESTA transacción (J4 de Pedernal: estado CERRADA y `xmin` de la transacción en curso).
CREATE FUNCTION "ControlDeJornadaCerrada_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."id" = NEW."jornadaId" AND j."sucursalId" = NEW."sucursalId" AND j."estado" = 'CERRADA' AND j.xmin = pg_current_xact_id()::xid) THEN
    RAISE EXCEPTION 'control_solo_al_cerrar_la_jornada' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ControlDeJornadaCerrada_validar" BEFORE INSERT ON "ControlDeJornadaCerrada" FOR EACH ROW EXECUTE FUNCTION "ControlDeJornadaCerrada_validar"();

-- CorreccionDeMedio: es de un COBRO, de la jornada de la sesión de ese cobro y con ella EN_AUDITORIA; «antes» es el medio vigente (el original o el destino de la corrección anterior) y la secuencia sigue sin huecos; el destino es un medio activo.
CREATE FUNCTION "CorreccionDeMedio_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; v_previa record; v_vigente uuid; v_secuencia integer; v_activo boolean;
BEGIN
  SELECT r."medioDePagoId" AS medio, s."sucursalId" AS sucursal, s."fechaDeNegocio" AS fecha INTO c
    FROM "Cobro" r JOIN "Cobranza" b ON b."empresaId" = r."empresaId" AND b."id" = r."cobranzaId" JOIN "SesionCaja" s ON s."empresaId" = b."empresaId" AND s."id" = b."sesionId"
   WHERE r."empresaId" = NEW."empresaId" AND r."id" = NEW."cobroId";
  IF NOT FOUND THEN RAISE EXCEPTION 'correccion_de_un_cobro_que_no_existe' USING ERRCODE = '23503'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."id" = NEW."jornadaId" AND j."sucursalId" = c.sucursal AND j."fechaDeNegocio" = c.fecha) THEN
    RAISE EXCEPTION 'correccion_de_otra_jornada_que_la_del_cobro' USING ERRCODE = '23514';
  END IF;
  PERFORM "JornadaDeSucursal_exigir_estado"(NEW."empresaId", NEW."jornadaId", NEW."sucursalId", 'EN_AUDITORIA');
  SELECT k."secuencia", k."medioDespuesId" INTO v_previa FROM "CorreccionDeMedio" k WHERE k."empresaId" = NEW."empresaId" AND k."cobroId" = NEW."cobroId" ORDER BY k."secuencia" DESC LIMIT 1;
  IF FOUND THEN v_secuencia := v_previa."secuencia"; v_vigente := v_previa."medioDespuesId"; ELSE v_secuencia := 0; v_vigente := c.medio; END IF;
  IF NEW."secuencia" <> v_secuencia + 1 THEN RAISE EXCEPTION 'correccion_secuencia_con_huecos' USING ERRCODE = '23514'; END IF;
  IF NEW."medioAntesId" <> v_vigente THEN RAISE EXCEPTION 'correccion_antes_no_es_el_vigente' USING ERRCODE = '23514'; END IF;
  SELECT m."activo" INTO v_activo FROM "MedioDePago" m WHERE m."empresaId" = NEW."empresaId" AND m."id" = NEW."medioDespuesId";
  IF v_activo IS NOT TRUE THEN RAISE EXCEPTION 'correccion_con_medio_inactivo' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CorreccionDeMedio_validar" BEFORE INSERT ON "CorreccionDeMedio" FOR EACH ROW EXECUTE FUNCTION "CorreccionDeMedio_validar"();

-- DeclaracionDeTotal: jornada EN_AUDITORIA; el medio no es efectivo (se cuenta por billetes al cerrar cada caja); la secuencia del medio sigue sin huecos.
CREATE FUNCTION "DeclaracionDeTotal_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo text; v_ultima integer;
BEGIN
  PERFORM "JornadaDeSucursal_exigir_estado"(NEW."empresaId", NEW."jornadaId", NEW."sucursalId", 'EN_AUDITORIA');
  SELECT m."tipo" INTO v_tipo FROM "MedioDePago" m WHERE m."empresaId" = NEW."empresaId" AND m."id" = NEW."medioDePagoId";
  IF v_tipo IS NULL THEN RAISE EXCEPTION 'medio_inexistente' USING ERRCODE = '23503'; END IF;
  IF v_tipo = 'EFECTIVO' THEN RAISE EXCEPTION 'el_efectivo_no_se_declara' USING ERRCODE = '23514'; END IF;
  SELECT coalesce(max(d."secuencia"), 0) INTO v_ultima FROM "DeclaracionDeTotal" d WHERE d."empresaId" = NEW."empresaId" AND d."jornadaId" = NEW."jornadaId" AND d."medioDePagoId" = NEW."medioDePagoId";
  IF NEW."secuencia" <> v_ultima + 1 THEN RAISE EXCEPTION 'declaracion_secuencia_con_huecos' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DeclaracionDeTotal_validar" BEFORE INSERT ON "DeclaracionDeTotal" FOR EACH ROW EXECUTE FUNCTION "DeclaracionDeTotal_validar"();

-- ConformeDeJornada: jornada EN_AUDITORIA.
CREATE FUNCTION "ConformeDeJornada_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "JornadaDeSucursal_exigir_estado"(NEW."empresaId", NEW."jornadaId", NEW."sucursalId", 'EN_AUDITORIA');
  RETURN NEW;
END $$;
CREATE TRIGGER "ConformeDeJornada_validar" BEFORE INSERT ON "ConformeDeJornada" FOR EACH ROW EXECUTE FUNCTION "ConformeDeJornada_validar"();

-- SesionCaja (reemplaza la función de C1): además de lo de C1, el SELLO es el vigente (zona de la empresa y hora de corte de la sucursal), la fecha de negocio sale de la fórmula y la jornada de esa sucursal y fecha está ABIERTA (la crea el caso de uso antes de insertar).
-- Con la jornada EN_AUDITORIA o CERRADA no se abre caja. `FOR SHARE`: frena un «empezar el cierre» concurrente. Al cambiar, sigue siendo solo ABIERTA → CERRADA, una vez.
CREATE OR REPLACE FUNCTION "SesionCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sucursal text; v_activa boolean; v_corte time; v_zona text; v_estado_de_jornada text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."estado" <> 'ABIERTA' THEN RAISE EXCEPTION 'sesion_caja_nace_abierta' USING ERRCODE = '23514'; END IF;
    SELECT c."sucursalId" INTO v_sucursal FROM "Caja" c WHERE c."empresaId" = NEW."empresaId" AND c."id" = NEW."cajaId";
    IF v_sucursal IS DISTINCT FROM NEW."sucursalId" THEN RAISE EXCEPTION 'sesion_caja_de_otra_sucursal' USING ERRCODE = '23514'; END IF;
    SELECT s."activo", s."horaDeCorte" INTO v_activa, v_corte FROM "Sucursal" s WHERE s."empresaId" = NEW."empresaId" AND s."id" = NEW."sucursalId";
    IF v_activa IS NOT TRUE THEN RAISE EXCEPTION 'sesion_caja_sucursal_inactiva' USING ERRCODE = '23514'; END IF;
    SELECT e."zonaHoraria" INTO v_zona FROM "Empresa" e WHERE e."id" = NEW."empresaId";
    IF NEW."horaDeCorte" IS DISTINCT FROM v_corte OR NEW."zonaHoraria" IS DISTINCT FROM v_zona THEN RAISE EXCEPTION 'sesion_caja_sello_invalido' USING ERRCODE = '23514'; END IF;
    IF NEW."fechaDeNegocio" IS DISTINCT FROM caja_fecha_de_negocio(NEW."abiertaEn", NEW."zonaHoraria", NEW."horaDeCorte") THEN RAISE EXCEPTION 'sesion_caja_fecha_de_negocio_invalida' USING ERRCODE = '23514'; END IF;
    SELECT j."estado" INTO v_estado_de_jornada FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."sucursalId" = NEW."sucursalId" AND j."fechaDeNegocio" = NEW."fechaDeNegocio" FOR SHARE;
    IF v_estado_de_jornada IS DISTINCT FROM 'ABIERTA' THEN RAISE EXCEPTION 'sesion_caja_jornada_no_abierta' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."estado" = 'CERRADA' THEN RAISE EXCEPTION 'sesion_caja_cerrada_no_se_toca' USING ERRCODE = '23514'; END IF;
  IF NEW."estado" <> 'CERRADA' THEN RAISE EXCEPTION 'sesion_caja_solo_pasa_a_cerrada' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

-- MovimientoCaja (reemplaza la función de C1): además de lo de C1, un movimiento solo entra con la jornada de su sesión ABIERTA («cobrar contra auditar» no existe); se admite el AJUSTE (cualquier medio activo; si corrige una jornada, esa jornada existe, está CERRADA y es anterior a la de la sesión);
-- se puede anular un ingreso, egreso o AJUSTE (espejo exacto), nunca un cobro.
CREATE OR REPLACE FUNCTION "MovimientoCaja_validar"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo text; v_activo boolean; o record; v_fecha date; v_sucursal text; v_estado_de_jornada text; v_estado_a_corregir text;
BEGIN
  PERFORM "SesionCaja_exigir_abierta"(NEW."empresaId", NEW."sesionId", NEW."sucursalId");
  SELECT s."fechaDeNegocio", s."sucursalId" INTO v_fecha, v_sucursal FROM "SesionCaja" s WHERE s."empresaId" = NEW."empresaId" AND s."id" = NEW."sesionId";
  SELECT j."estado" INTO v_estado_de_jornada FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."sucursalId" = v_sucursal AND j."fechaDeNegocio" = v_fecha FOR SHARE;
  IF v_estado_de_jornada IS DISTINCT FROM 'ABIERTA' THEN RAISE EXCEPTION 'movimiento_caja_jornada_no_abierta' USING ERRCODE = '23514'; END IF;
  SELECT m."tipo", m."activo" INTO v_tipo, v_activo FROM "MedioDePago" m WHERE m."empresaId" = NEW."empresaId" AND m."id" = NEW."medioDePagoId";
  IF NEW."clase" IN ('FONDO_INICIAL', 'INGRESO_MANUAL', 'EGRESO_MANUAL') AND v_tipo IS DISTINCT FROM 'EFECTIVO' THEN
    RAISE EXCEPTION 'movimiento_manual_solo_en_efectivo' USING ERRCODE = '23514';
  END IF;
  IF NEW."clase" = 'COBRO' AND v_activo IS NOT TRUE THEN RAISE EXCEPTION 'cobro_con_medio_inactivo' USING ERRCODE = '23514'; END IF;
  IF NEW."clase" = 'AJUSTE' AND v_activo IS NOT TRUE THEN RAISE EXCEPTION 'ajuste_con_medio_inactivo' USING ERRCODE = '23514'; END IF;
  IF NEW."clase" = 'ANULACION' THEN
    SELECT a."clase", a."sesionId", a."medioDePagoId", a."importe" INTO o FROM "MovimientoCaja" a WHERE a."empresaId" = NEW."empresaId" AND a."id" = NEW."anulaAId";
    IF o."clase" IS NULL OR o."clase" NOT IN ('INGRESO_MANUAL', 'EGRESO_MANUAL', 'AJUSTE') THEN RAISE EXCEPTION 'anulacion_de_movimiento_no_anulable' USING ERRCODE = '23514'; END IF;
    IF o."sesionId" <> NEW."sesionId" OR o."medioDePagoId" <> NEW."medioDePagoId" OR o."importe" <> -NEW."importe" THEN RAISE EXCEPTION 'anulacion_no_es_el_espejo' USING ERRCODE = '23514'; END IF;
  END IF;
  IF NEW."corrigeJornada" IS NOT NULL THEN
    SELECT j."estado" INTO v_estado_a_corregir FROM "JornadaDeSucursal" j WHERE j."empresaId" = NEW."empresaId" AND j."sucursalId" = v_sucursal AND j."fechaDeNegocio" = NEW."corrigeJornada";
    IF v_estado_a_corregir IS NULL THEN RAISE EXCEPTION 'ajuste_corrige_jornada_inexistente' USING ERRCODE = '23514'; END IF;
    IF v_estado_a_corregir <> 'CERRADA' THEN RAISE EXCEPTION 'ajuste_corrige_jornada_no_cerrada' USING ERRCODE = '23514'; END IF;
    IF NEW."corrigeJornada" >= v_fecha THEN RAISE EXCEPTION 'ajuste_corrige_jornada_no_anterior' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- ===== RLS por empresa (las políticas por sucursal van en 20261117115000) =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['JornadaDeSucursal', 'ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY aislamiento_empresa ON %I USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()))', t);
  END LOOP;
END
$$;

-- ===== Privilegios (si los roles existen): leer y agregar; NUNCA borrar. La jornada la crea quien tiene actividad (solo las columnas de identidad) y su estado cambia por columna. La consola de plataforma no las toca. =====
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    FOREACH t IN ARRAY ARRAY['JornadaDeSucursal', 'ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada'] LOOP
      EXECUTE format('REVOKE ALL ON %I FROM motor2_app', t);
    END LOOP;
    GRANT SELECT ON "JornadaDeSucursal" TO motor2_app;
    GRANT INSERT ("id", "empresaId", "sucursalId", "fechaDeNegocio") ON "JornadaDeSucursal" TO motor2_app;
    GRANT UPDATE ("estado", "auditoriaIniciadaEn", "auditoriaIniciadaPorId", "cerradaEn", "cerradaPorId", "huellaDeCierre", "observacion") ON "JornadaDeSucursal" TO motor2_app;
    FOREACH t IN ARRAY ARRAY['ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada'] LOOP
      EXECUTE format('GRANT SELECT, INSERT ON %I TO motor2_app', t);
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    FOREACH t IN ARRAY ARRAY['JornadaDeSucursal', 'ControlDeJornadaCerrada', 'CorreccionDeMedio', 'DeclaracionDeTotal', 'ConformeDeJornada'] LOOP
      EXECUTE format('REVOKE ALL ON %I FROM motor2_plataforma', t);
    END LOOP;
  END IF;
END
$$;

-- ===== Sesiones que ya existieran (C1): su jornada, ABIERTA (la jornada no se cierra sola). Idempotente. =====
INSERT INTO "JornadaDeSucursal" ("id", "empresaId", "sucursalId", "fechaDeNegocio")
SELECT gen_random_uuid(), s."empresaId", s."sucursalId", s."fechaDeNegocio" FROM "SesionCaja" s GROUP BY s."empresaId", s."sucursalId", s."fechaDeNegocio"
ON CONFLICT DO NOTHING;
