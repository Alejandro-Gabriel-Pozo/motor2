-- Planes versionados (frente 4, etapa M1; decisión del dueño 2026-11-16: «Planes con versiones desde el inicio, como Pedernal»). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base.
-- ADITIVA: agrega 3 tablas y funciones; no toca ninguna tabla existente. El código viejo las ignora. NADA del guard ni del menú lee todavía el plan (M1 NO aplica el techo; eso es M1b).
--
--   Plan          el paquete (global, sin precio). `codigo` único. Solo plataforma.
--   VersionDePlan el contenido: BORRADOR (a lo sumo uno por plan, se edita) → PUBLICADA (INMUTABLE, con número consecutivo por plan). `modulos` es el TECHO de módulos vendibles.
--   PlanDeEmpresa la asignación empresa → versión. SOLO SE AGREGA (número consecutivo por empresa; el vigente se CALCULA, nunca se marca ni se edita).
--
-- Nombre de la columna `aplicaDesde` (en Pedernal `vigente_desde`): diferencia declarada, Motor2 retiró la palabra «vigencia» del código por decisión del dueño (test/carta/retirados-por-decision-del-duenio.test.tsx).
--
-- Privilegios y candados (igual que ModuloEmpresa / AuditoriaPlataforma): `motor2_app` pierde todo en Plan y VersionDePlan y solo LEE PlanDeEmpresa (de su empresa, por RLS); `motor2_plataforma` escribe sin DELETE.
-- Triggers: el dueño queda exento (migra y limpia la base de test); cualquier otro rol sin permiso es rechazado aunque un GRANT futuro se lo diera.
--
-- BACKFILL (decisión del dueño, q4: «Todos los módulos disponibles»): el plan «actual» versión 1 con los 9 módulos vendibles disponibles (los mismos de `MODULOS`; un test compara las dos listas), asignado
-- a TODA empresa existente en cualquier estado. ⚠ SE VUELVE A PREGUNTAR AL DUEÑO ANTES DE APLICAR EN CUALQUIER BASE REAL: «todos» abre a toda empresa existente módulos que quizá no usa. Si responde «solo los que
-- cada empresa tiene hoy», se cambia la constante `MODULOS_DEL_PLAN_ACTUAL` (src/core/features/empresa/plan-de-transicion.ts) y la lista de abajo, y se corre `verificacion-previa.sql`.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261117100000_planes_versionados`).

-- 1) Plan
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "claveIdempotencia" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Plan_codigo_forma_check" CHECK ("codigo" ~ '^[a-z][a-z0-9-]{1,39}$'),
    CONSTRAINT "Plan_estado_check" CHECK ("estado" IN ('ACTIVO', 'RETIRADO'))
);
CREATE UNIQUE INDEX "Plan_codigo_key" ON "Plan"("codigo");
CREATE UNIQUE INDEX "Plan_claveIdempotencia_key" ON "Plan"("claveIdempotencia");

-- 2) VersionDePlan
CREATE TABLE "VersionDePlan" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "numero" INTEGER,
    "nombreComercial" TEXT NOT NULL,
    "modulos" TEXT[] NOT NULL,
    "motivo" TEXT,
    "claveIdempotencia" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "publicadaEn" TIMESTAMPTZ(3),
    "publicadaPor" TEXT,

    CONSTRAINT "VersionDePlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VersionDePlan_estado_check" CHECK ("estado" IN ('BORRADOR', 'PUBLICADA')),
    CONSTRAINT "VersionDePlan_numero_segun_estado_check" CHECK (
      ("estado" = 'BORRADOR' AND "numero" IS NULL AND "publicadaEn" IS NULL AND "publicadaPor" IS NULL)
      OR ("estado" = 'PUBLICADA' AND "numero" >= 1 AND "publicadaEn" IS NOT NULL AND "publicadaPor" IS NOT NULL)
    ),
    CONSTRAINT "VersionDePlan_nombre_check" CHECK (length(btrim("nombreComercial")) BETWEEN 1 AND 80),
    CONSTRAINT "VersionDePlan_modulos_check" CHECK (cardinality("modulos") <= 20 AND array_position("modulos", NULL) IS NULL),
    CONSTRAINT "VersionDePlan_motivo_check" CHECK ("motivo" IS NULL OR length("motivo") BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX "VersionDePlan_claveIdempotencia_key" ON "VersionDePlan"("claveIdempotencia");
CREATE UNIQUE INDEX "VersionDePlan_planId_numero_key" ON "VersionDePlan"("planId", "numero");
-- A lo sumo UN borrador por plan.
CREATE UNIQUE INDEX "VersionDePlan_un_borrador_por_plan" ON "VersionDePlan"("planId") WHERE "estado" = 'BORRADOR';
ALTER TABLE "VersionDePlan" ADD CONSTRAINT "VersionDePlan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) PlanDeEmpresa (de empresa, escrita por la plataforma: sin default de `empresaId`)
CREATE TABLE "PlanDeEmpresa" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL,
    "versionDePlanId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "aplicaDesde" TIMESTAMPTZ(3) NOT NULL,
    "origen" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "asignadoPor" TEXT NOT NULL,
    "claveIdempotencia" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "PlanDeEmpresa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanDeEmpresa_numero_check" CHECK ("numero" >= 1),
    CONSTRAINT "PlanDeEmpresa_origen_check" CHECK ("origen" IN ('TRANSICION', 'ALTA', 'CAMBIO')),
    CONSTRAINT "PlanDeEmpresa_motivo_check" CHECK (length(btrim("motivo")) BETWEEN 1 AND 500),
    CONSTRAINT "PlanDeEmpresa_asignadoPor_check" CHECK (length(btrim("asignadoPor")) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "PlanDeEmpresa_empresaId_numero_key" ON "PlanDeEmpresa"("empresaId", "numero");
CREATE UNIQUE INDEX "PlanDeEmpresa_claveIdempotencia_key" ON "PlanDeEmpresa"("claveIdempotencia");
CREATE INDEX "PlanDeEmpresa_versionDePlanId_idx" ON "PlanDeEmpresa"("versionDePlanId");
ALTER TABLE "PlanDeEmpresa" ADD CONSTRAINT "PlanDeEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanDeEmpresa" ADD CONSTRAINT "PlanDeEmpresa_versionDePlanId_fkey" FOREIGN KEY ("versionDePlanId") REFERENCES "VersionDePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) RLS
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "Plan" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');
ALTER TABLE "VersionDePlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "VersionDePlan" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');
ALTER TABLE "PlanDeEmpresa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PlanDeEmpresa" FOR SELECT
  USING ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY escritura_plataforma ON "PlanDeEmpresa" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');

-- 5) Privilegios (si los roles existen)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "Plan", "VersionDePlan", "PlanDeEmpresa" FROM motor2_app;
    GRANT SELECT ON "PlanDeEmpresa" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "Plan", "VersionDePlan", "PlanDeEmpresa" FROM motor2_plataforma;
    GRANT SELECT, INSERT, UPDATE ON "Plan", "VersionDePlan" TO motor2_plataforma;
    GRANT SELECT, INSERT ON "PlanDeEmpresa" TO motor2_plataforma;
  END IF;
END
$$;

-- 6) Candados. Función común: el dueño queda exento; `motor2_plataforma` solo INSERT/UPDATE; cualquier otro, nada.
CREATE FUNCTION proteger_tablas_de_planes() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  IF current_user = 'motor2_plataforma' AND (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% solo lo escribe la plataforma: % no permitido para el rol %', TG_TABLE_NAME, TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "Plan_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "Plan"
  FOR EACH ROW EXECUTE FUNCTION proteger_tablas_de_planes();
CREATE TRIGGER "Plan_solo_plataforma_truncate" BEFORE TRUNCATE ON "Plan"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_tablas_de_planes();
CREATE TRIGGER "VersionDePlan_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "VersionDePlan"
  FOR EACH ROW EXECUTE FUNCTION proteger_tablas_de_planes();
CREATE TRIGGER "VersionDePlan_solo_plataforma_truncate" BEFORE TRUNCATE ON "VersionDePlan"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_tablas_de_planes();
CREATE TRIGGER "PlanDeEmpresa_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "PlanDeEmpresa"
  FOR EACH ROW EXECUTE FUNCTION proteger_tablas_de_planes();
CREATE TRIGGER "PlanDeEmpresa_solo_plataforma_truncate" BEFORE TRUNCATE ON "PlanDeEmpresa"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_tablas_de_planes();

-- 7) Reglas de integridad que NO dependen de la aplicación.
-- 7a) Una versión PUBLICADA es inmutable (ningún UPDATE ni DELETE, ni del dueño); un BORRADOR solo puede quedar BORRADOR (se edita) o pasar a PUBLICADA con el número SIGUIENTE del plan.
--     Plan: el código no cambia nunca; el estado solo ACTIVO → RETIRADO (no vuelve).
CREATE FUNCTION reglas_de_version_de_plan() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  siguiente integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'VersionDePlan no se borra' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."estado" <> 'BORRADOR' THEN
      RAISE EXCEPTION 'Una versión de plan nace en BORRADOR' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."estado" = 'PUBLICADA' THEN
    RAISE EXCEPTION 'Una versión publicada es inmutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."planId" <> OLD."planId" OR NEW."id" <> OLD."id" THEN
    RAISE EXCEPTION 'Una versión no cambia de plan' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."estado" = 'PUBLICADA' THEN
    SELECT COALESCE(max("numero"), 0) + 1 INTO siguiente FROM "VersionDePlan" WHERE "planId" = NEW."planId";
    IF NEW."numero" IS DISTINCT FROM siguiente THEN
      RAISE EXCEPTION 'El número de la versión publicada tiene que ser el siguiente del plan (%).', siguiente USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "VersionDePlan_reglas" BEFORE INSERT OR UPDATE OR DELETE ON "VersionDePlan"
  FOR EACH ROW EXECUTE FUNCTION reglas_de_version_de_plan();

CREATE FUNCTION reglas_de_plan() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plan no se borra: se retira' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."codigo" <> OLD."codigo" OR NEW."id" <> OLD."id" THEN
      RAISE EXCEPTION 'El código de un plan no cambia' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD."estado" = 'RETIRADO' AND NEW."estado" <> 'RETIRADO' THEN
      RAISE EXCEPTION 'Un plan retirado no vuelve' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "Plan_reglas" BEFORE UPDATE OR DELETE ON "Plan"
  FOR EACH ROW EXECUTE FUNCTION reglas_de_plan();

-- 7b) PlanDeEmpresa solo se agrega (ningún UPDATE ni DELETE, ni del dueño) y el número es el SIGUIENTE de la empresa; la versión tiene que estar PUBLICADA.
CREATE FUNCTION reglas_de_plan_de_empresa() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  siguiente integer;
  estado_version text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'PlanDeEmpresa solo se agrega: % no permitido', TG_OP USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT "estado" INTO estado_version FROM "VersionDePlan" WHERE "id" = NEW."versionDePlanId";
  IF estado_version IS DISTINCT FROM 'PUBLICADA' THEN
    RAISE EXCEPTION 'Solo se asigna una versión PUBLICADA' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT COALESCE(max("numero"), 0) + 1 INTO siguiente FROM "PlanDeEmpresa" WHERE "empresaId" = NEW."empresaId";
  IF NEW."numero" <> siguiente THEN
    RAISE EXCEPTION 'El número de la asignación tiene que ser el siguiente de la empresa (%).', siguiente USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "PlanDeEmpresa_solo_se_agrega" BEFORE UPDATE OR DELETE ON "PlanDeEmpresa"
  FOR EACH ROW EXECUTE FUNCTION reglas_de_plan_de_empresa();
CREATE TRIGGER "PlanDeEmpresa_reglas_de_alta" BEFORE INSERT ON "PlanDeEmpresa"
  FOR EACH ROW EXECUTE FUNCTION reglas_de_plan_de_empresa();

-- 8) Backfill de transición (⚠ ver el encabezado: «todos los módulos disponibles», a re-preguntar antes de aplicar en una base real). Una sola transacción (la de Prisma): o queda todo o nada. Idempotente.
-- Ids fijos para el plan y su versión (los genera la migración, no la aplicación; únicos en el sentido de uuid v5 no hace falta: se usan literales).
INSERT INTO "Plan" ("id", "codigo", "estado", "claveIdempotencia", "payloadHash")
VALUES ('00000000-0000-4000-8000-0000000a0001', 'actual', 'ACTIVO', '00000000-0000-4000-8000-0000000a0002', 'transicion-m1')
ON CONFLICT ("codigo") DO NOTHING;

INSERT INTO "VersionDePlan" ("id", "planId", "estado", "nombreComercial", "modulos", "motivo", "claveIdempotencia", "payloadHash")
SELECT '00000000-0000-4000-8000-0000000a0003', p."id", 'BORRADOR', 'Actual',
       ARRAY['stock', 'compras', 'traspasos', 'consignacion', 'recetas', 'produccion', 'carta', 'promociones', 'salon'],
       'Plan de transición: todos los módulos vendibles disponibles', '00000000-0000-4000-8000-0000000a0004', 'transicion-m1'
FROM "Plan" p WHERE p."codigo" = 'actual'
ON CONFLICT ("id") DO NOTHING;

UPDATE "VersionDePlan" SET "estado" = 'PUBLICADA', "numero" = 1, "publicadaEn" = now(), "publicadaPor" = 'migracion:planes_versionados'
WHERE "id" = '00000000-0000-4000-8000-0000000a0003' AND "estado" = 'BORRADOR';

INSERT INTO "PlanDeEmpresa" ("id", "empresaId", "versionDePlanId", "numero", "aplicaDesde", "origen", "motivo", "asignadoPor", "claveIdempotencia", "payloadHash")
SELECT gen_random_uuid(), e."id", '00000000-0000-4000-8000-0000000a0003', 1, now(), 'TRANSICION',
       'Plan de transición: toda empresa existente parte del plan «actual»', 'migracion:planes_versionados', gen_random_uuid(), 'transicion-m1'
FROM "Empresa" e
WHERE NOT EXISTS (SELECT 1 FROM "PlanDeEmpresa" x WHERE x."empresaId" = e."id");
