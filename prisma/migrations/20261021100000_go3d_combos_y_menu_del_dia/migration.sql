-- GO-3d (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): COMBOS Y MENÚ DEL DÍA (ADR-032, frente D). TOCA DOS TABLAS CON DATOS (`PromoCarta` y `PromoCartaCupo`), solo con columnas nuevas NULABLES o con un DEFAULT constante,
-- crea tres tablas y da de alta UNA clave de permiso.
--   PromoCarta.vigenteDesde/vigenteHasta  la vigencia opcional de la promo (DATE local de la zona de la empresa, rango inclusive; NULL = sin límite). CHECK desde <= hasta.
--   PromoCarta.diasDeSemana               máscara de los días en que vale (bit 0 = lunes … bit 6 = domingo; 1 a 127, CHECK). NULL = todos los días (D-7).
--   PromoCarta.version                    el control OPTIMISTA de la edición de la promo (`UPDATE … WHERE version = esperada`; 0 filas = VERSION_DESACTUALIZADA): INTEGER NOT NULL DEFAULT 1 (constante: solo metadatos en PG >= 11;
--                                         todas las promos de hoy quedan en 1), CHECK >= 1. Lo incrementa la aplicación (GO-3 F3); la base solo garantiza el piso.
--   PromoCartaCupo.tipo                   SECCION (todas las filas de hoy, por el DEFAULT), LISTA o DEL_DIA (CHECK). `seccionCartaId` pasa a NULABLE: obligatoria si y solo si el tipo es SECCION (CHECK).
--   PromoCartaCupo.nombre                 el nombre del lugar fuera de SECCION (CHECK; único por promo sin importar mayúsculas: índice parcial).
--   PromoCartaCupo.activo                 la baja lógica del cupo (DEFAULT true): desde GO-3 un cupo no se borra.
--   EntradaDeCupo                         cada producto de un cupo LISTA (aunque esté fuera de carta), con una configuración fija opcional (`claveConfiguracion`, el canónico ordenado `opcionId=cantidad;…`, NO la huella). DE LA EMPRESA.
--   OpcionDeEntradaDeCupo                 cada opción de esa configuración fija (SOLO se agrega: la configuración es parte de la identidad de la entrada). DE LA EMPRESA.
--   EntradaDelDiaDeCupo                   el plato del día de un cupo DEL_DIA por sucursal y por FECHA (D-1). PROPIA de la sucursal (sus políticas, en GO-3d-rls).
--   clave `promo_menu_del_dia`            sucursal, piso operario, clase O delegable al encargado (D-5), sembrada al rol `admin` de cada empresa (patrón GO-1a). Entra a `ACCIONES` con su caso de uso (GO-3 F3).
--
-- ADITIVA y SIN RELLENO: las filas de hoy quedan como están (los DEFAULT constantes son solo metadatos en PG >= 11; ningún dato se reescribe). Ninguna regla puede fallar con lo que ya existe: todo cupo de hoy es SECCION con sección,
-- sin nombre y activo. Los CHECK van sin `NOT VALID` + `VALIDATE`: en una sola transacción no reducen ningún bloqueo (el ALTER ya tomó ACCESS EXCLUSIVE) y validan tablas chicas.
-- Que el producto de una entrada o de un plato del día sea PV, esté disponible en la sucursal, tenga precio de referencia (D-8) y origen de stock (D-9), y que `claveConfiguracion` coincida con sus opciones, lo valida la aplicación.
--
-- EXPANDIR Y CONTRAER: el código anterior a GO-3 se rompe con un cupo LISTA o DEL_DIA (lee `seccionCarta.nombre` de un cupo sin sección) y vería como vigentes los cupos dados de baja. Por eso el PRIMER despliegue (esta migración más
-- el código tolerante: todos los lectores filtran `tipo = 'SECCION' AND activo` y no ofrecen una promo con un cupo de tipo nuevo) va antes que las funciones que crean los tipos nuevos. Ver docs/deploy-con-migraciones.md.
--
-- AL APLICAR: toma ACCESS EXCLUSIVE sobre `PromoCarta` y `PromoCartaCupo` (tablas chicas) hasta el COMMIT, y un instante SHARE ROW EXCLUSIVE sobre `Empresa`, `Producto`, `Sucursal`, `User` y `OpcionDeGrupo` por las claves foráneas.
-- Hacerlo con `SET lock_timeout = '5s'` y sin tráfico de administración de la carta. Requiere el rol motor2_app si existe (los GRANT son condicionales), GO-1b (las opciones) y la función app_empresa_actual() (default de empresaId).
-- Las políticas de sucursal de `EntradaDelDiaDeCupo` llegan en la migración siguiente (GO-3d-rls, 20261021101000), que es la salida exacta del generador: esta migración NO las crea.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back`). NO destructiva: ABORTA si hay una entrada, un plato del día, un cupo de tipo nuevo, con nombre o dado de baja,
-- una promo con vigencia o ya editada con la versión (`version` distinta de 1), o si la configuración de la clave ya no es la semilla. Se baja DESPUÉS de GO-3d-rls.

ALTER TABLE "PromoCarta" ADD COLUMN IF NOT EXISTS "vigenteDesde" DATE, ADD COLUMN IF NOT EXISTS "vigenteHasta" DATE, ADD COLUMN IF NOT EXISTS "diasDeSemana" SMALLINT;
ALTER TABLE "PromoCarta" DROP CONSTRAINT IF EXISTS "PromoCarta_dias_de_semana_chk";
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_dias_de_semana_chk" CHECK ("diasDeSemana" IS NULL OR "diasDeSemana" BETWEEN 1 AND 127);
ALTER TABLE "PromoCarta" DROP CONSTRAINT IF EXISTS "PromoCarta_vigencia_chk";
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_vigencia_chk" CHECK ("vigenteDesde" IS NULL OR "vigenteHasta" IS NULL OR "vigenteDesde" <= "vigenteHasta");
ALTER TABLE "PromoCarta" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PromoCarta" DROP CONSTRAINT IF EXISTS "PromoCarta_version_chk";
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_version_chk" CHECK ("version" >= 1);

ALTER TABLE "PromoCartaCupo" ADD COLUMN IF NOT EXISTS "tipo" TEXT NOT NULL DEFAULT 'SECCION', ADD COLUMN IF NOT EXISTS "nombre" TEXT, ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PromoCartaCupo" ALTER COLUMN "seccionCartaId" DROP NOT NULL;
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT IF EXISTS "PromoCartaCupo_tipo_chk";
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_tipo_chk" CHECK ("tipo" IN ('SECCION', 'LISTA', 'DEL_DIA'));
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT IF EXISTS "PromoCartaCupo_seccion_solo_en_seccion_chk";
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_seccion_solo_en_seccion_chk" CHECK (("tipo" = 'SECCION') = ("seccionCartaId" IS NOT NULL));
-- El nombre: con algún carácter visible y hasta 80 cuando está; obligatorio fuera de SECCION.
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT IF EXISTS "PromoCartaCupo_nombre_chk";
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_nombre_chk" CHECK (("nombre" IS NULL OR ("nombre" ~ '\S' AND char_length("nombre") <= 80)) AND ("tipo" = 'SECCION' OR "nombre" IS NOT NULL));
DROP INDEX IF EXISTS "PromoCartaCupo_nombre_lower_key";
CREATE UNIQUE INDEX "PromoCartaCupo_nombre_lower_key" ON "PromoCartaCupo" ("promoCartaId", lower("nombre")) WHERE "tipo" <> 'SECCION';

CREATE TABLE "EntradaDeCupo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "cupoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "claveConfiguracion" TEXT NOT NULL DEFAULT '',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntradaDeCupo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntradaDeCupo_cupoId_productoId_claveConfiguracion_key" ON "EntradaDeCupo"("cupoId", "productoId", "claveConfiguracion");
CREATE UNIQUE INDEX "EntradaDeCupo_empresaId_id_key" ON "EntradaDeCupo"("empresaId", "id");
CREATE INDEX "EntradaDeCupo_productoId_idx" ON "EntradaDeCupo"("productoId");
ALTER TABLE "EntradaDeCupo" ADD CONSTRAINT "EntradaDeCupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntradaDeCupo" ADD CONSTRAINT "EntradaDeCupo_empresaId_cupoId_fkey" FOREIGN KEY ("empresaId", "cupoId") REFERENCES "PromoCartaCupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntradaDeCupo" ADD CONSTRAINT "EntradaDeCupo_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- El canónico de la configuración: vacío, o pares `opcionId=cantidad` (cantidad 1 a 10) separados por `;` (el orden por `opcionId` lo garantiza `claveDeConfiguracion`).
ALTER TABLE "EntradaDeCupo" ADD CONSTRAINT "EntradaDeCupo_clave_configuracion_chk" CHECK ("claveConfiguracion" ~ '^([^;=\s]+=([1-9]|10)(;[^;=\s]+=([1-9]|10))*)?$' AND char_length("claveConfiguracion") <= 2000);
ALTER TABLE "EntradaDeCupo" ADD CONSTRAINT "EntradaDeCupo_orden_chk" CHECK ("orden" >= 0);

CREATE TABLE "OpcionDeEntradaDeCupo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "entradaId" TEXT NOT NULL,
    "opcionId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpcionDeEntradaDeCupo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpcionDeEntradaDeCupo_entradaId_opcionId_key" ON "OpcionDeEntradaDeCupo"("entradaId", "opcionId");
CREATE UNIQUE INDEX "OpcionDeEntradaDeCupo_empresaId_id_key" ON "OpcionDeEntradaDeCupo"("empresaId", "id");
CREATE INDEX "OpcionDeEntradaDeCupo_opcionId_idx" ON "OpcionDeEntradaDeCupo"("opcionId");
ALTER TABLE "OpcionDeEntradaDeCupo" ADD CONSTRAINT "OpcionDeEntradaDeCupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionDeEntradaDeCupo" ADD CONSTRAINT "OpcionDeEntradaDeCupo_empresaId_entradaId_fkey" FOREIGN KEY ("empresaId", "entradaId") REFERENCES "EntradaDeCupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionDeEntradaDeCupo" ADD CONSTRAINT "OpcionDeEntradaDeCupo_empresaId_opcionId_fkey" FOREIGN KEY ("empresaId", "opcionId") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionDeEntradaDeCupo" ADD CONSTRAINT "OpcionDeEntradaDeCupo_cantidad_chk" CHECK ("cantidad" BETWEEN 1 AND 10);

CREATE TABLE "EntradaDelDiaDeCupo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "cupoId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "productoId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntradaDelDiaDeCupo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EntradaDelDiaDeCupo_cupoId_sucursalId_fecha_productoId_key" ON "EntradaDelDiaDeCupo"("cupoId", "sucursalId", "fecha", "productoId");
CREATE UNIQUE INDEX "EntradaDelDiaDeCupo_empresaId_id_key" ON "EntradaDelDiaDeCupo"("empresaId", "id");
CREATE INDEX "EntradaDelDiaDeCupo_sucursalId_fecha_idx" ON "EntradaDelDiaDeCupo"("sucursalId", "fecha");
CREATE INDEX "EntradaDelDiaDeCupo_productoId_idx" ON "EntradaDelDiaDeCupo"("productoId");
ALTER TABLE "EntradaDelDiaDeCupo" ADD CONSTRAINT "EntradaDelDiaDeCupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntradaDelDiaDeCupo" ADD CONSTRAINT "EntradaDelDiaDeCupo_empresaId_cupoId_fkey" FOREIGN KEY ("empresaId", "cupoId") REFERENCES "PromoCartaCupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntradaDelDiaDeCupo" ADD CONSTRAINT "EntradaDelDiaDeCupo_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntradaDelDiaDeCupo" ADD CONSTRAINT "EntradaDelDiaDeCupo_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntradaDelDiaDeCupo" ADD CONSTRAINT "EntradaDelDiaDeCupo_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntradaDeCupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "EntradaDeCupo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "OpcionDeEntradaDeCupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OpcionDeEntradaDeCupo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "EntradaDelDiaDeCupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "EntradaDelDiaDeCupo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "EntradaDeCupo", "OpcionDeEntradaDeCupo", "EntradaDelDiaDeCupo" FROM motor2_app;
    GRANT SELECT, INSERT ON "EntradaDeCupo", "OpcionDeEntradaDeCupo", "EntradaDelDiaDeCupo" TO motor2_app;
    GRANT UPDATE ("orden", "activa", "actualizadoEn") ON "EntradaDeCupo" TO motor2_app;
    GRANT UPDATE ("activa", "actualizadoPorId", "actualizadoEn") ON "EntradaDelDiaDeCupo" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "EntradaDeCupo", "OpcionDeEntradaDeCupo", "EntradaDelDiaDeCupo" FROM motor2_plataforma;
  END IF;
END
$$;

-- La clave `promo_menu_del_dia` y su siembra al `admin` de cada empresa (patrón GO-1a: sin copia desde otras claves y sin `CapacidadSucursal`). El `empresaId` de cada fila sale de la fila del rol (la migración corre como dueño, sin RLS). `ON CONFLICT` no pisa
-- lo que el gerente ya tocó. Una empresa que nace entre GO-3d y la entrada de la clave a `ACCIONES` no recibe la fila: volver a correr este INSERT (idempotente) con su propia autorización. Antes se mira con:
--   SELECT r."empresaId" FROM "Rol" r WHERE r."clave" = 'admin' AND NOT EXISTS (SELECT 1 FROM "PermisoRol" p WHERE p."rolId" = r."id" AND p."accionClave" = 'promo_menu_del_dia');
INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('promo_menu_del_dia', 'Cargar el plato del día de los menús en la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'promo_menu_del_dia', true, true
FROM "Rol" r
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
