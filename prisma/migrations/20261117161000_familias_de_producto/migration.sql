-- Carta, familias de productos etapa F1 (docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md, niveles 6 y 7; Pedernal 0079 y 0080). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo).
-- Decisiones del dueño (2026-11-17): «Familias nuevas como Pedernal (Recomendada)» (familias por EMPRESA); «Sobre item agrupado se va una vez que entra familia» (la familia reemplaza al ítem agrupado: el invariante de abajo es TRANSITORIO);
-- «Solo los que se venden» (solo un producto PV es miembro; lo controla el caso de uso, no la base); «Solo el nombre, como Pedernal» (la familia lleva el nombre y dos interruptores, nada más).
--
-- QUÉ: DOS tablas nuevas, `FamiliaDeProducto` (por empresa: nombre único sin distinguir mayúsculas, dos interruptores que NACEN APAGADOS, activa, versión) y `MiembroDeFamilia` (qué producto está en qué familia, con posición, quién lo agregó y cuándo,
-- y quién lo quitó y cuándo: NADA se borra; volver a agregar un producto es una fila NUEVA). No se toca `Producto` (ni una columna) ni ninguna otra tabla existente; solo se le agrega un disparador a `OpcionItemAgrupadoCarta` (ver abajo).
--
-- QUÉ DECIDE LA BASE: un nombre por empresa (único sobre `nombreClave`); el largo del nombre; la versión desde 1; la familia y el producto son de la MISMA empresa (claves foráneas compuestas); un producto está en UNA sola familia a la vez (único parcial
-- sobre los miembros vigentes, aun con dos pedidos simultáneos); una posición por familia (único parcial) entre 1 y 1000 (protección de la base, no una regla de negocio: no hay tope de miembros); un miembro quitado no vuelve a cambiar y quitar escribe
-- quién y cuándo juntos; la identidad de una familia y de un miembro no cambia; y el INVARIANTE TRANSITORIO (D2): un producto no está a la vez en una familia vigente y en un ítem agrupado. La app NO puede borrar (sin DELETE ni TRUNCATE) y solo cambia
-- las columnas con privilegio. QUÉ DECIDE EL CASO DE USO: permisos, que el producto sea de venta, la posición (máximo + 1 con la familia bloqueada), el control de versión, «ya estaba», los mensajes y la auditoría.
--
-- INVARIANTE TRANSITORIO «un producto no está a la vez en una familia y en un ítem agrupado» (§6.4): vive en la BASE, con un disparador en cada tabla, para que ningún camino (pantalla, otro caso de uso, SQL a mano) lo viole. Se retira junto con el ítem agrupado
-- (etapa R5 del diseño). Los dos disparadores toman EL MISMO bloqueo por producto (`pg_advisory_xact_lock` sobre empresa + producto) antes de mirar la otra tabla, y son SECURITY DEFINER a propósito (mismo criterio que `rechazar_suma_a_producto_oculto`): leen
-- la otra tabla SIN pasar por la RLS por sucursal del rol de la app (los ítems agrupados son por sucursal; una fila que la política no deja ver no puede abrir el control: falla cerrado). `search_path` fijo; solo leen. El ítem agrupado cuenta ACTIVO O NO
-- (conservador: para liberar el producto hay que sacarlo del ítem agrupado). Error: SQLSTATE 23514 con restricción nombrada (`producto_ya_agrupado`, `producto_ya_miembro_de_familia`), que se repite al principio del mensaje (el adaptador de Prisma entrega solo el texto del error, no el nombre de la restricción: así lo reconoce la aplicación, como `MovimientoStock_producto_oculto_chk`) y que la aplicación traduce. No revalidan filas viejas.
--
-- LÍMITE DECLARADO DEL INVARIANTE (verificación adversarial, 2026-11-17; ACEPTADO por el dueño el 2026-11-17, chat: «Si vamos a sacar ítem agrupado, no entiendo por qué marcarlo como error.» y «Mergear F1 como está.»):
-- dos administradores simultáneos, uno desde familias y otro desde el ítem agrupado, podrían dejar un producto en los dos lados. El bloqueo por producto ordena a los dos disparadores, pero la alta a familia corre en SERIALIZABLE
-- (su foto ya está tomada antes de pedir el bloqueo) y la alta de una opción de ítem agrupado corre SIN transacción (READ COMMITTED, como antes de F1): la primera no ve lo que la segunda acaba de confirmar. Se acepta hasta que se saque el
-- ítem agrupado (etapas R2 a R5 del diseño). Cerrarlo del todo sería correr las dos altas en SERIALIZABLE o sumar una fila de bloqueo compartida por producto (una tabla): NO se hizo, a pedido del dueño.
--
-- MOLDE (docs/diseno-datos-paridad-pedernal-2026-11-16.md, E-0): `id` UUID nativo que genera la app; instantes TIMESTAMPTZ(3); la app NO tiene DELETE ni TRUNCATE. RLS por empresa (`aislamiento_empresa`); no son tablas de sucursal.
-- ADITIVA: tablas nuevas y un disparador; no toca ninguna fila ni columna existentes. El código anterior no las lee ni las escribe (nada las lee hasta la etapa F4), así que se puede aplicar por adelantado y el Instant Rollback de Vercel sigue siendo seguro.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117161000_familias_de_producto`).

-- CreateTable
CREATE TABLE "FamiliaDeProducto" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "nombre" TEXT NOT NULL,
    "nombreClave" TEXT NOT NULL,
    "agruparEnCarta" BOOLEAN NOT NULL DEFAULT false,
    "agruparEnPos" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FamiliaDeProducto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MiembroDeFamilia" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "familiaId" UUID NOT NULL,
    "productoId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "agregadoPorId" TEXT NOT NULL,
    "agregadoEn" TIMESTAMPTZ(3) NOT NULL,
    "quitadoPorId" TEXT,
    "quitadoEn" TIMESTAMPTZ(3),

    CONSTRAINT "MiembroDeFamilia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamiliaDeProducto_empresaId_nombreClave_key" ON "FamiliaDeProducto"("empresaId", "nombreClave");

-- CreateIndex
CREATE UNIQUE INDEX "FamiliaDeProducto_empresaId_id_key" ON "FamiliaDeProducto"("empresaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MiembroDeFamilia_empresaId_id_key" ON "MiembroDeFamilia"("empresaId", "id");

-- CreateIndex
CREATE INDEX "MiembroDeFamilia_familiaId_idx" ON "MiembroDeFamilia"("familiaId");

-- CreateIndex
CREATE INDEX "MiembroDeFamilia_productoId_idx" ON "MiembroDeFamilia"("productoId");

-- Un producto, una sola familia a la vez (sobre los miembros vigentes), aun con dos pedidos simultáneos. Prisma no modela índices parciales: lo declara solo esta migración.
CREATE UNIQUE INDEX "MiembroDeFamilia_producto_vigente_key" ON "MiembroDeFamilia"("empresaId", "productoId") WHERE "quitadoEn" IS NULL;

-- Una posición por familia (sobre los miembros vigentes).
CREATE UNIQUE INDEX "MiembroDeFamilia_posicion_vigente_key" ON "MiembroDeFamilia"("empresaId", "familiaId", "posicion") WHERE "quitadoEn" IS NULL;

-- AddForeignKey
ALTER TABLE "FamiliaDeProducto" ADD CONSTRAINT "FamiliaDeProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiembroDeFamilia" ADD CONSTRAINT "MiembroDeFamilia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiembroDeFamilia" ADD CONSTRAINT "MiembroDeFamilia_empresaId_familiaId_fkey" FOREIGN KEY ("empresaId", "familiaId") REFERENCES "FamiliaDeProducto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MiembroDeFamilia" ADD CONSTRAINT "MiembroDeFamilia_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre): largo del nombre y de su clave, versión desde 1; posición de 1 a 1000 (protección de la base); quitar escribe quién y cuándo JUNTOS (los dos o ninguno).
ALTER TABLE "FamiliaDeProducto" ADD CONSTRAINT "FamiliaDeProducto_nombre_chk" CHECK (char_length("nombre") BETWEEN 1 AND 120 AND char_length("nombreClave") >= 1);
ALTER TABLE "FamiliaDeProducto" ADD CONSTRAINT "FamiliaDeProducto_version_chk" CHECK ("version" >= 1);
ALTER TABLE "MiembroDeFamilia" ADD CONSTRAINT "MiembroDeFamilia_posicion_chk" CHECK ("posicion" BETWEEN 1 AND 1000);
ALTER TABLE "MiembroDeFamilia" ADD CONSTRAINT "MiembroDeFamilia_quitado_chk" CHECK (("quitadoEn" IS NULL) = ("quitadoPorId" IS NULL));

-- La identidad de la familia no cambia (id, empresa, autor y fecha de alta).
CREATE FUNCTION "FamiliaDeProducto_proteger"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."empresaId" <> OLD."empresaId" OR NEW."creadoPorId" <> OLD."creadoPorId" OR NEW."creadoEn" <> OLD."creadoEn" THEN
    RAISE EXCEPTION 'la identidad de una familia de productos no cambia (id, empresa, autor y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'FamiliaDeProducto_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "FamiliaDeProducto_proteger" BEFORE UPDATE ON "FamiliaDeProducto" FOR EACH ROW EXECUTE FUNCTION "FamiliaDeProducto_proteger"();

-- Un miembro quitado no cambia más; en uno vigente solo se escribe «quitado» (quién y cuándo), nunca su identidad, su familia, su producto ni su posición.
CREATE FUNCTION "MiembroDeFamilia_proteger"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF OLD."quitadoEn" IS NOT NULL THEN
    RAISE EXCEPTION 'un miembro quitado de una familia no cambia más'
      USING ERRCODE = '23514', CONSTRAINT = 'MiembroDeFamilia_quitado_inmutable';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."empresaId" <> OLD."empresaId" OR NEW."familiaId" <> OLD."familiaId" OR NEW."productoId" <> OLD."productoId"
     OR NEW."posicion" <> OLD."posicion" OR NEW."agregadoPorId" <> OLD."agregadoPorId" OR NEW."agregadoEn" <> OLD."agregadoEn" THEN
    RAISE EXCEPTION 'la identidad de un miembro de familia no cambia (id, empresa, familia, producto, posición, autor y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'MiembroDeFamilia_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "MiembroDeFamilia_proteger" BEFORE UPDATE ON "MiembroDeFamilia" FOR EACH ROW EXECUTE FUNCTION "MiembroDeFamilia_proteger"();

-- INVARIANTE TRANSITORIO (D2), lado de la familia: un miembro VIGENTE no se agrega si el producto está en un ítem agrupado (de cualquier sucursal de la empresa, activo o no).
CREATE FUNCTION "MiembroDeFamilia_no_si_agrupado"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW."quitadoEn" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('familia-o-agrupado:' || NEW."empresaId" || ':' || NEW."productoId", 0));
  IF EXISTS (SELECT 1 FROM "OpcionItemAgrupadoCarta" o WHERE o."empresaId" = NEW."empresaId" AND o."productoId" = NEW."productoId") THEN
    RAISE EXCEPTION 'producto_ya_agrupado: el producto ya está en un ítem agrupado, no puede estar a la vez en una familia'
      USING ERRCODE = '23514', CONSTRAINT = 'producto_ya_agrupado';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION "MiembroDeFamilia_no_si_agrupado"() IS 'Familias (F1, D2): un producto no está a la vez en una familia y en un ítem agrupado (invariante TRANSITORIO hasta que el ítem agrupado se retire).';
CREATE TRIGGER "MiembroDeFamilia_no_si_agrupado" BEFORE INSERT ON "MiembroDeFamilia" FOR EACH ROW EXECUTE FUNCTION "MiembroDeFamilia_no_si_agrupado"();

-- INVARIANTE TRANSITORIO (D2), lado del ítem agrupado: una opción no se agrega (ni cambia de producto) si el producto es miembro VIGENTE de una familia.
CREATE FUNCTION "OpcionItemAgrupadoCarta_no_si_en_familia"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('familia-o-agrupado:' || NEW."empresaId" || ':' || NEW."productoId", 0));
  IF EXISTS (SELECT 1 FROM "MiembroDeFamilia" m WHERE m."empresaId" = NEW."empresaId" AND m."productoId" = NEW."productoId" AND m."quitadoEn" IS NULL) THEN
    RAISE EXCEPTION 'producto_ya_miembro_de_familia: el producto ya es miembro de una familia, no puede estar a la vez en un ítem agrupado'
      USING ERRCODE = '23514', CONSTRAINT = 'producto_ya_miembro_de_familia';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION "OpcionItemAgrupadoCarta_no_si_en_familia"() IS 'Familias (F1, D2): un producto no está a la vez en un ítem agrupado y en una familia (invariante TRANSITORIO hasta que el ítem agrupado se retire).';
CREATE TRIGGER "OpcionItemAgrupadoCarta_no_si_en_familia" BEFORE INSERT OR UPDATE OF "productoId" ON "OpcionItemAgrupadoCarta" FOR EACH ROW EXECUTE FUNCTION "OpcionItemAgrupadoCarta_no_si_en_familia"();

-- RLS por empresa (no son tablas de sucursal: sin políticas de alcance)
ALTER TABLE "FamiliaDeProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FamiliaDeProducto"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "MiembroDeFamilia" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "MiembroDeFamilia"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): leer y agregar; cambiar SOLO las columnas que el caso de uso toca; nunca borrar. La consola de plataforma no las toca.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "FamiliaDeProducto" FROM motor2_app;
    GRANT SELECT, INSERT ON "FamiliaDeProducto" TO motor2_app;
    GRANT UPDATE ("nombre", "nombreClave", "agruparEnCarta", "agruparEnPos", "activa", "version", "actualizadoEn") ON "FamiliaDeProducto" TO motor2_app;
    REVOKE ALL ON "MiembroDeFamilia" FROM motor2_app;
    GRANT SELECT, INSERT ON "MiembroDeFamilia" TO motor2_app;
    GRANT UPDATE ("quitadoPorId", "quitadoEn") ON "MiembroDeFamilia" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "FamiliaDeProducto" FROM motor2_plataforma;
    REVOKE ALL ON "MiembroDeFamilia" FROM motor2_plataforma;
  END IF;
END
$$;
