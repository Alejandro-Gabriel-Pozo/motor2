-- Reversa de 20261022101000_retiro_go3a (retiro de GO-3a, esquema): vuelve a crear, VACÍO, todo lo que la migración borró, con el MISMO SQL que 20261021110000_go3a_combinaciones (su cuerpo, copiado
-- sin cambios): la columna `ProductoAdmiteGrupo.ejeDeCombinacion` con su CHECK y su índice único parcial, las seis tablas con sus índices, reglas, claves foráneas, RLS por empresa y privilegios, y la
-- clave `grupos_de_precio_definir` con su siembra al rol `admin` de cada empresa. No hay datos que devolver: la migración solo se aplicó si no había ninguno.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción), fuera del horario de servicio (`SET lock_timeout = '5s'`: la clave foránea de la foto toma un bloqueo breve
-- sobre `CuentaItem`); después `npx prisma migrate resolve --rolled-back 20261022101000_retiro_go3a`. Se corre ANTES del down.sql de 20261022100000_retiro_go3a_rls (que vuelve a crear las
-- políticas de sucursal de dos de estas tablas). Con la reversa aplicada, el código de la Fase 3 sigue andando (no lee estas tablas); el código anterior a la Fase 3 vuelve a poder desplegarse.

ALTER TABLE "ProductoAdmiteGrupo" ADD COLUMN IF NOT EXISTS "ejeDeCombinacion" SMALLINT;
ALTER TABLE "ProductoAdmiteGrupo" DROP CONSTRAINT IF EXISTS "ProductoAdmiteGrupo_eje_de_combinacion_chk";
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_eje_de_combinacion_chk" CHECK ("ejeDeCombinacion" IS NULL OR "ejeDeCombinacion" IN (1, 2));
DROP INDEX IF EXISTS "ProductoAdmiteGrupo_un_grupo_por_eje_key";
CREATE UNIQUE INDEX "ProductoAdmiteGrupo_un_grupo_por_eje_key" ON "ProductoAdmiteGrupo" ("productoId", "ejeDeCombinacion") WHERE "ejeDeCombinacion" IS NOT NULL;

CREATE TABLE "GrupoDePrecio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(14,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrupoDePrecio_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GrupoDePrecio_empresaId_id_key" ON "GrupoDePrecio"("empresaId", "id");
CREATE UNIQUE INDEX "GrupoDePrecio_empresaId_nombre_key" ON "GrupoDePrecio"("empresaId", "nombre");
CREATE UNIQUE INDEX "GrupoDePrecio_nombre_lower_key" ON "GrupoDePrecio" ("empresaId", lower("nombre"));
ALTER TABLE "GrupoDePrecio" ADD CONSTRAINT "GrupoDePrecio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrupoDePrecio" ADD CONSTRAINT "GrupoDePrecio_nombre_chk" CHECK ("nombre" ~ '\S' AND char_length("nombre") <= 80);
ALTER TABLE "GrupoDePrecio" ADD CONSTRAINT "GrupoDePrecio_precio_chk" CHECK ("precio" >= 0.01);
ALTER TABLE "GrupoDePrecio" ADD CONSTRAINT "GrupoDePrecio_version_chk" CHECK ("version" >= 1);

CREATE TABLE "CombinacionDeProducto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "productoId" TEXT NOT NULL,
    "opcionEje1Id" TEXT NOT NULL,
    "opcionEje2Id" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "precio" DECIMAL(14,2),
    "grupoDePrecioId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CombinacionDeProducto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CombinacionDeProducto_empresaId_id_key" ON "CombinacionDeProducto"("empresaId", "id");
CREATE INDEX "CombinacionDeProducto_grupoDePrecioId_idx" ON "CombinacionDeProducto"("grupoDePrecioId");
-- Una combinación por (producto, eje 1, eje 2): con el eje 2 NULL, `COALESCE` la hace única igual (un único común trataría dos NULL como distintos). Solo vive en la migración.
CREATE UNIQUE INDEX "CombinacionDeProducto_identidad_key" ON "CombinacionDeProducto" ("productoId", "opcionEje1Id", COALESCE("opcionEje2Id", ''));
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_empresaId_opcionEje1Id_fkey" FOREIGN KEY ("empresaId", "opcionEje1Id") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_empresaId_opcionEje2Id_fkey" FOREIGN KEY ("empresaId", "opcionEje2Id") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_empresaId_grupoDePrecioId_fkey" FOREIGN KEY ("empresaId", "grupoDePrecioId") REFERENCES "GrupoDePrecio"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_ejes_distintos_chk" CHECK ("opcionEje2Id" IS NULL OR "opcionEje2Id" <> "opcionEje1Id");
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_precio_o_grupo_chk" CHECK (NOT ("precio" IS NOT NULL AND "grupoDePrecioId" IS NOT NULL));
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_precio_chk" CHECK ("precio" IS NULL OR "precio" >= 0.01);
ALTER TABLE "CombinacionDeProducto" ADD CONSTRAINT "CombinacionDeProducto_version_chk" CHECK ("version" >= 1);

CREATE TABLE "PrecioLocalDeCombinacion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "combinacionId" TEXT,
    "grupoDePrecioId" TEXT,
    "precio" DECIMAL(14,2) NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrecioLocalDeCombinacion_pkey" PRIMARY KEY ("id")
);
-- Un precio por (sucursal, combinación) y uno por (sucursal, grupo). Únicos comunes (no parciales): la columna que no se usa es NULL, y dos NULL son distintos, así que se comportan igual que dos únicos parciales y Prisma los puede declarar.
CREATE UNIQUE INDEX "PrecioLocalDeCombinacion_sucursalId_combinacionId_key" ON "PrecioLocalDeCombinacion"("sucursalId", "combinacionId");
CREATE UNIQUE INDEX "PrecioLocalDeCombinacion_sucursalId_grupoDePrecioId_key" ON "PrecioLocalDeCombinacion"("sucursalId", "grupoDePrecioId");
CREATE UNIQUE INDEX "PrecioLocalDeCombinacion_empresaId_id_key" ON "PrecioLocalDeCombinacion"("empresaId", "id");
ALTER TABLE "PrecioLocalDeCombinacion" ADD CONSTRAINT "PrecioLocalDeCombinacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeCombinacion" ADD CONSTRAINT "PrecioLocalDeCombinacion_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeCombinacion" ADD CONSTRAINT "PrecioLocalDeCombinacion_empresaId_combinacionId_fkey" FOREIGN KEY ("empresaId", "combinacionId") REFERENCES "CombinacionDeProducto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeCombinacion" ADD CONSTRAINT "PrecioLocalDeCombinacion_empresaId_grupoDePrecioId_fkey" FOREIGN KEY ("empresaId", "grupoDePrecioId") REFERENCES "GrupoDePrecio"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalDeCombinacion" ADD CONSTRAINT "PrecioLocalDeCombinacion_de_una_cosa_chk" CHECK (num_nonnulls("combinacionId", "grupoDePrecioId") = 1);
ALTER TABLE "PrecioLocalDeCombinacion" ADD CONSTRAINT "PrecioLocalDeCombinacion_precio_chk" CHECK ("precio" >= 0.01);

CREATE TABLE "RecetaDeCombinacionVersion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "combinacionId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecetaDeCombinacionVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecetaDeCombinacionVersion_empresaId_id_key" ON "RecetaDeCombinacionVersion"("empresaId", "id");
CREATE UNIQUE INDEX "RecetaDeCombinacionVersion_combinacionId_numero_key" ON "RecetaDeCombinacionVersion"("combinacionId", "numero");
CREATE INDEX "RecetaDeCombinacionVersion_creadoPorId_idx" ON "RecetaDeCombinacionVersion"("creadoPorId");
ALTER TABLE "RecetaDeCombinacionVersion" ADD CONSTRAINT "RecetaDeCombinacionVersion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionVersion" ADD CONSTRAINT "RecetaDeCombinacionVersion_empresaId_combinacionId_fkey" FOREIGN KEY ("empresaId", "combinacionId") REFERENCES "CombinacionDeProducto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionVersion" ADD CONSTRAINT "RecetaDeCombinacionVersion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionVersion" ADD CONSTRAINT "RecetaDeCombinacionVersion_numero_chk" CHECK ("numero" >= 1);

CREATE TABLE "RecetaDeCombinacionIngrediente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "versionId" TEXT NOT NULL,
    "insumoProductoId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "unidadId" TEXT NOT NULL,
    "mermaPorcentaje" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RecetaDeCombinacionIngrediente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecetaDeCombinacionIngrediente_empresaId_id_key" ON "RecetaDeCombinacionIngrediente"("empresaId", "id");
CREATE UNIQUE INDEX "RecetaDeCombinacionIngrediente_versionId_orden_key" ON "RecetaDeCombinacionIngrediente"("versionId", "orden");
CREATE INDEX "RecetaDeCombinacionIngrediente_insumoProductoId_idx" ON "RecetaDeCombinacionIngrediente"("insumoProductoId");
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_empresaId_versionId_fkey" FOREIGN KEY ("empresaId", "versionId") REFERENCES "RecetaDeCombinacionVersion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_empresaId_insumoProductoId_fkey" FOREIGN KEY ("empresaId", "insumoProductoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_empresaId_unidadId_fkey" FOREIGN KEY ("empresaId", "unidadId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_cantidad_chk" CHECK ("cantidad" > 0);
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_merma_chk" CHECK ("mermaPorcentaje" BETWEEN 0 AND 100);
ALTER TABLE "RecetaDeCombinacionIngrediente" ADD CONSTRAINT "RecetaDeCombinacionIngrediente_orden_chk" CHECK ("orden" >= 0);

CREATE TABLE "CombinacionEnLinea" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "cuentaItemId" TEXT NOT NULL,
    "combinacionId" TEXT NOT NULL,
    "origenPrecio" TEXT NOT NULL,
    "precioDeSucursal" BOOLEAN NOT NULL DEFAULT false,
    "grupoDePrecioId" TEXT,
    "nombreGrupoDePrecio" TEXT,
    "precio" DECIMAL(14,2),
    "recetaDeCombinacionVersionId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CombinacionEnLinea_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CombinacionEnLinea_empresaId_id_key" ON "CombinacionEnLinea"("empresaId", "id");
CREATE UNIQUE INDEX "CombinacionEnLinea_cuentaItemId_key" ON "CombinacionEnLinea"("cuentaItemId");
CREATE INDEX "CombinacionEnLinea_combinacionId_idx" ON "CombinacionEnLinea"("combinacionId");
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_empresaId_cuentaItemId_fkey" FOREIGN KEY ("empresaId", "cuentaItemId") REFERENCES "CuentaItem"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_empresaId_combinacionId_fkey" FOREIGN KEY ("empresaId", "combinacionId") REFERENCES "CombinacionDeProducto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_empresaId_grupoDePrecioId_fkey" FOREIGN KEY ("empresaId", "grupoDePrecioId") REFERENCES "GrupoDePrecio"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_empresaId_recetaDeCombinacionVersionId_fkey" FOREIGN KEY ("empresaId", "recetaDeCombinacionVersionId") REFERENCES "RecetaDeCombinacionVersion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_origen_precio_chk" CHECK ("origenPrecio" IN ('ADITIVO', 'PROPIO', 'GRUPO'));
-- ADITIVO: la combinación no tenía precio (rige el de GO-1, que ya queda en la línea y en la foto de las opciones): sin precio ni grupo ni precio de sucursal. PROPIO: el precio de la combinación. GRUPO: el del grupo, con su nombre copiado.
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_origen_coherente_chk" CHECK (
  ("origenPrecio" = 'ADITIVO' AND "precio" IS NULL AND "grupoDePrecioId" IS NULL AND "nombreGrupoDePrecio" IS NULL AND NOT "precioDeSucursal")
  OR ("origenPrecio" = 'PROPIO' AND "precio" IS NOT NULL AND "grupoDePrecioId" IS NULL AND "nombreGrupoDePrecio" IS NULL)
  OR ("origenPrecio" = 'GRUPO' AND "precio" IS NOT NULL AND "grupoDePrecioId" IS NOT NULL AND "nombreGrupoDePrecio" IS NOT NULL));
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_precio_chk" CHECK ("precio" IS NULL OR "precio" >= 0.01);
ALTER TABLE "CombinacionEnLinea" ADD CONSTRAINT "CombinacionEnLinea_nombre_grupo_chk" CHECK ("nombreGrupoDePrecio" IS NULL OR ("nombreGrupoDePrecio" ~ '\S' AND char_length("nombreGrupoDePrecio") <= 80));

ALTER TABLE "GrupoDePrecio" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "GrupoDePrecio"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "CombinacionDeProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CombinacionDeProducto"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PrecioLocalDeCombinacion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PrecioLocalDeCombinacion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RecetaDeCombinacionVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaDeCombinacionVersion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RecetaDeCombinacionIngrediente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaDeCombinacionIngrediente"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "CombinacionEnLinea" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CombinacionEnLinea"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "GrupoDePrecio", "CombinacionDeProducto", "PrecioLocalDeCombinacion", "RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea" FROM motor2_app;
    GRANT SELECT, INSERT ON "GrupoDePrecio", "CombinacionDeProducto", "PrecioLocalDeCombinacion", "RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea" TO motor2_app;
    GRANT UPDATE ("nombre", "precio", "activo", "version", "actualizadoEn") ON "GrupoDePrecio" TO motor2_app;
    GRANT UPDATE ("activa", "precio", "grupoDePrecioId", "version", "actualizadoEn") ON "CombinacionDeProducto" TO motor2_app;
    GRANT UPDATE ("precio", "habilitado", "actualizadoEn") ON "PrecioLocalDeCombinacion" TO motor2_app;
    -- `ProductoAdmiteGrupo` tiene privilegios de UPDATE por columna (GO-1b): la columna nueva necesita el suyo.
    GRANT UPDATE ("ejeDeCombinacion") ON "ProductoAdmiteGrupo" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "GrupoDePrecio", "CombinacionDeProducto", "PrecioLocalDeCombinacion", "RecetaDeCombinacionVersion", "RecetaDeCombinacionIngrediente", "CombinacionEnLinea" FROM motor2_plataforma;
  END IF;
END
$$;

-- La clave `grupos_de_precio_definir` y su siembra al `admin` de cada empresa (patrón GO-1a). Una empresa que nace entre GO-3a y la entrada de la clave a `ACCIONES` no recibe la fila: volver a correr este INSERT (idempotente) con su propia
-- autorización. Antes se mira con:
--   SELECT r."empresaId" FROM "Rol" r WHERE r."clave" = 'admin' AND NOT EXISTS (SELECT 1 FROM "PermisoRol" p WHERE p."rolId" = r."id" AND p."accionClave" = 'grupos_de_precio_definir');
INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('grupos_de_precio_definir', 'Definir las tarifas compartidas (grupos de precio) de las combinaciones')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'grupos_de_precio_definir', true, true
FROM "Rol" r
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
