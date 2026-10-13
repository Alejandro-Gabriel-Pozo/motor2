-- GO-1b (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): el CATÁLOGO de los grupos de opciones de venta (el «elemento configurable»: tamaño, variante, incluida, adicional): seis tablas nuevas,
-- todas DE LA EMPRESA (sin `sucursalId`, solo RLS por empresa). No toca ninguna tabla existente, no cambia importes y no siembra ningún grupo ni opción. Nada de `src/` las escribe todavía (GO-2).
--   GrupoDeOpciones       el grupo (tipo inmutable, cantidades mínima y máxima, versión de edición)
--   OpcionDeGrupo         una opción del grupo (la «ninguna», el producto ANCLA de un adicional)
--   VersionDeOpcion       la diferencia de precio de la opción, por versiones (SOLO se agrega; la vigente es la de número mayor)
--   ConsumoDeOpcion       lo que consume cada versión de una opción (SOLO se agrega)
--   ProductoAdmiteGrupo   qué grupos admite cada producto y con qué límites
--   ProductoAdmiteOpcion  qué opciones admite cada producto y a qué precio de lista
-- Las listas cerradas (tipo de grupo, efecto de consumo, modo de precio, tipo de diferencia) van como TEXT + CHECK, no como enum de Postgres: agregar o quitar un valor es cambiar un CHECK (reversible), no un `ALTER TYPE` (que no se deshace). El tipo para TypeScript sale de
-- `src/core/opciones/tipos.ts` y un test de paridad compara las listas con los CHECK. Dinero siempre DECIMAL exacto (`numeric(14,2)`, el porcentaje `(7,4)`, el factor `(8,4)`), nunca float.
-- La VERSIÓN VIGENTE de una opción es la de `numero` mayor (sin flag ni UPDATE): una versión nueva lleva `numero = vigente + 1` y dos simultáneas dan 23505 (gana una). Rige desde su `creadoEn` (UTC). Solo se agregan versiones y consumos: la app tiene SELECT e INSERT, nunca UPDATE ni DELETE.
-- `GrupoDeOpciones`, `OpcionDeGrupo`, `ProductoAdmiteGrupo` y `ProductoAdmiteOpcion` se editan por columna (nunca `tipo`, `grupoId`, `productoId` ni `esNinguna`) con `version` como control optimista (lo aplica la aplicación; la base solo garantiza `version >= 1`). Nunca DELETE: la baja es desactivar.
-- Aditiva: sin relleno y sin CONCURRENTLY (las tablas nacen vacías); al aplicar conviene `SET lock_timeout = '5s'` (las claves foráneas toman un instante SHARE ROW EXCLUSIVE sobre Empresa, Producto, Unidad y User).
-- Requiere el rol motor2_app si existe (los GRANT son condicionales) y la función app_empresa_actual() (default de empresaId).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back`). NO destructiva: ABORTA si hay filas. Se baja DESPUÉS de GO-1c-rls, GO-1c, GO-1d-rls y GO-1d (con ellas arriba el `DROP TABLE` falla por dependencias, a propósito).

CREATE TABLE "GrupoDeOpciones" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidadMinima" INTEGER NOT NULL DEFAULT 0,
    "cantidadMaxima" INTEGER NOT NULL DEFAULT 1,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrupoDeOpciones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GrupoDeOpciones_empresaId_id_key" ON "GrupoDeOpciones"("empresaId", "id");
CREATE UNIQUE INDEX "GrupoDeOpciones_empresaId_nombre_key" ON "GrupoDeOpciones"("empresaId", "nombre");
CREATE UNIQUE INDEX "GrupoDeOpciones_nombre_lower_key" ON "GrupoDeOpciones" ("empresaId", lower("nombre"));
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_nombre_chk" CHECK ("nombre" ~ '\S' AND char_length("nombre") <= 80);
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_tipo_chk" CHECK ("tipo" IN ('MEDIDA', 'VARIANTE', 'INCLUIDA', 'ADICIONAL'));
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_cantidades_chk" CHECK ("cantidadMinima" >= 0 AND "cantidadMinima" <= "cantidadMaxima" AND "cantidadMaxima" BETWEEN 1 AND 10);
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_medida_chk" CHECK ("tipo" <> 'MEDIDA' OR ("cantidadMinima" = 1 AND "cantidadMaxima" = 1));
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_incluida_chk" CHECK ("tipo" <> 'INCLUIDA' OR "cantidadMinima" >= 1);
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_version_chk" CHECK ("version" >= 1);

CREATE TABLE "OpcionDeGrupo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "grupoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "esNinguna" BOOLEAN NOT NULL DEFAULT false,
    "productoId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpcionDeGrupo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpcionDeGrupo_empresaId_id_key" ON "OpcionDeGrupo"("empresaId", "id");
CREATE UNIQUE INDEX "OpcionDeGrupo_grupoId_nombre_key" ON "OpcionDeGrupo"("grupoId", "nombre");
CREATE UNIQUE INDEX "OpcionDeGrupo_nombre_lower_key" ON "OpcionDeGrupo" ("grupoId", lower("nombre"));
CREATE UNIQUE INDEX "OpcionDeGrupo_empresaId_productoId_key" ON "OpcionDeGrupo"("empresaId", "productoId");
CREATE UNIQUE INDEX "OpcionDeGrupo_una_ninguna_por_grupo_key" ON "OpcionDeGrupo" ("grupoId") WHERE "esNinguna";
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_empresaId_grupoId_fkey" FOREIGN KEY ("empresaId", "grupoId") REFERENCES "GrupoDeOpciones"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_nombre_chk" CHECK ("nombre" ~ '\S' AND char_length("nombre") <= 80);
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_ninguna_sin_producto_chk" CHECK (NOT ("esNinguna" AND "productoId" IS NOT NULL));
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_orden_chk" CHECK ("orden" >= 0);
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_version_chk" CHECK ("version" >= 1);

CREATE TABLE "VersionDeOpcion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "opcionId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipoDeDiferencia" TEXT NOT NULL,
    "diferenciaPrecio" DECIMAL(14,2),
    "porcentaje" DECIMAL(7,4),
    "factorEscala" DECIMAL(8,4),
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VersionDeOpcion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VersionDeOpcion_creadoPorId_idx" ON "VersionDeOpcion"("creadoPorId");
CREATE UNIQUE INDEX "VersionDeOpcion_empresaId_id_key" ON "VersionDeOpcion"("empresaId", "id");
CREATE UNIQUE INDEX "VersionDeOpcion_opcionId_numero_key" ON "VersionDeOpcion"("opcionId", "numero");
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_empresaId_opcionId_fkey" FOREIGN KEY ("empresaId", "opcionId") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_numero_chk" CHECK ("numero" >= 1);
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_tipo_de_diferencia_chk" CHECK ("tipoDeDiferencia" IN ('MONTO', 'PORCENTAJE'));
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_diferencia_chk" CHECK (
  ("tipoDeDiferencia" = 'MONTO' AND "diferenciaPrecio" IS NOT NULL AND "porcentaje" IS NULL)
  OR ("tipoDeDiferencia" = 'PORCENTAJE' AND "porcentaje" IS NOT NULL AND "diferenciaPrecio" IS NULL));
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_porcentaje_chk" CHECK ("porcentaje" IS NULL OR ("porcentaje" > -100 AND "porcentaje" <= 999.9999));
ALTER TABLE "VersionDeOpcion" ADD CONSTRAINT "VersionDeOpcion_factor_chk" CHECK ("factorEscala" IS NULL OR ("factorEscala" > 0 AND "factorEscala" <= 10));

CREATE TABLE "ConsumoDeOpcion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "versionDeOpcionId" TEXT NOT NULL,
    "efecto" TEXT NOT NULL,
    "insumoProductoId" TEXT NOT NULL,
    "reemplazaAProductoId" TEXT,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "unidadId" TEXT NOT NULL,
    "mermaPorcentaje" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "escalaConLaMedida" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ConsumoDeOpcion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsumoDeOpcion_insumoProductoId_idx" ON "ConsumoDeOpcion"("insumoProductoId");
CREATE UNIQUE INDEX "ConsumoDeOpcion_empresaId_id_key" ON "ConsumoDeOpcion"("empresaId", "id");
CREATE UNIQUE INDEX "ConsumoDeOpcion_versionDeOpcionId_orden_key" ON "ConsumoDeOpcion"("versionDeOpcionId", "orden");
CREATE UNIQUE INDEX "ConsumoDeOpcion_un_reemplazo_por_insumo_key" ON "ConsumoDeOpcion" ("versionDeOpcionId", "reemplazaAProductoId") WHERE "reemplazaAProductoId" IS NOT NULL;
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_empresaId_versionDeOpcionId_fkey" FOREIGN KEY ("empresaId", "versionDeOpcionId") REFERENCES "VersionDeOpcion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_empresaId_insumoProductoId_fkey" FOREIGN KEY ("empresaId", "insumoProductoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_empresaId_reemplazaAProductoId_fkey" FOREIGN KEY ("empresaId", "reemplazaAProductoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_empresaId_unidadId_fkey" FOREIGN KEY ("empresaId", "unidadId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_efecto_chk" CHECK ("efecto" IN ('SUMA', 'REEMPLAZA'));
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_reemplazo_chk" CHECK (("efecto" = 'REEMPLAZA') = ("reemplazaAProductoId" IS NOT NULL));
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_cantidad_chk" CHECK ("cantidad" > 0);
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_merma_chk" CHECK ("mermaPorcentaje" BETWEEN 0 AND 100);
ALTER TABLE "ConsumoDeOpcion" ADD CONSTRAINT "ConsumoDeOpcion_orden_chk" CHECK ("orden" >= 0);

CREATE TABLE "ProductoAdmiteGrupo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "productoId" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cantidadMinima" INTEGER,
    "cantidadMaxima" INTEGER,
    "modoPrecio" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductoAdmiteGrupo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductoAdmiteGrupo_grupoId_idx" ON "ProductoAdmiteGrupo"("grupoId");
CREATE UNIQUE INDEX "ProductoAdmiteGrupo_productoId_grupoId_key" ON "ProductoAdmiteGrupo"("productoId", "grupoId");
CREATE UNIQUE INDEX "ProductoAdmiteGrupo_empresaId_id_key" ON "ProductoAdmiteGrupo"("empresaId", "id");
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_empresaId_grupoId_fkey" FOREIGN KEY ("empresaId", "grupoId") REFERENCES "GrupoDeOpciones"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_cantidades_chk" CHECK (
  ("cantidadMinima" IS NULL OR "cantidadMinima" BETWEEN 0 AND 10)
  AND ("cantidadMaxima" IS NULL OR "cantidadMaxima" BETWEEN 1 AND 10)
  AND ("cantidadMinima" IS NULL OR "cantidadMaxima" IS NULL OR "cantidadMinima" <= "cantidadMaxima"));
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_modo_precio_chk" CHECK ("modoPrecio" IS NULL OR "modoPrecio" IN ('ABSOLUTO', 'DIFERENCIA'));
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_orden_chk" CHECK ("orden" >= 0);
ALTER TABLE "ProductoAdmiteGrupo" ADD CONSTRAINT "ProductoAdmiteGrupo_version_chk" CHECK ("version" >= 1);

CREATE TABLE "ProductoAdmiteOpcion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "productoId" TEXT NOT NULL,
    "opcionId" TEXT NOT NULL,
    "cantidadMaxima" INTEGER NOT NULL DEFAULT 1,
    "precioAbsoluto" DECIMAL(14,2),
    "tipoDeDiferencia" TEXT,
    "diferenciaPrecio" DECIMAL(14,2),
    "porcentaje" DECIMAL(7,4),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductoAdmiteOpcion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductoAdmiteOpcion_opcionId_idx" ON "ProductoAdmiteOpcion"("opcionId");
CREATE UNIQUE INDEX "ProductoAdmiteOpcion_productoId_opcionId_key" ON "ProductoAdmiteOpcion"("productoId", "opcionId");
CREATE UNIQUE INDEX "ProductoAdmiteOpcion_empresaId_id_key" ON "ProductoAdmiteOpcion"("empresaId", "id");
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_empresaId_opcionId_fkey" FOREIGN KEY ("empresaId", "opcionId") REFERENCES "OpcionDeGrupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_cantidad_maxima_chk" CHECK ("cantidadMaxima" BETWEEN 1 AND 10);
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_precio_absoluto_chk" CHECK ("precioAbsoluto" IS NULL OR "precioAbsoluto" >= 0.01);
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_tipo_de_diferencia_chk" CHECK ("tipoDeDiferencia" IS NULL OR "tipoDeDiferencia" IN ('MONTO', 'PORCENTAJE'));
-- `IS NOT DISTINCT FROM` y no `=`: con el tipo NULL, `tipo = 'MONTO'` da NULL (desconocido) y un CHECK que da NULL PASA, así que un monto o un porcentaje sin tipo se colaría.
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_diferencia_chk" CHECK (
  ("tipoDeDiferencia" IS NULL AND "diferenciaPrecio" IS NULL AND "porcentaje" IS NULL)
  OR ("tipoDeDiferencia" IS NOT DISTINCT FROM 'MONTO' AND "diferenciaPrecio" IS NOT NULL AND "porcentaje" IS NULL)
  OR ("tipoDeDiferencia" IS NOT DISTINCT FROM 'PORCENTAJE' AND "porcentaje" IS NOT NULL AND "diferenciaPrecio" IS NULL));
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_absoluto_o_diferencia_chk" CHECK (NOT ("precioAbsoluto" IS NOT NULL AND "tipoDeDiferencia" IS NOT NULL));
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_porcentaje_chk" CHECK ("porcentaje" IS NULL OR ("porcentaje" > -100 AND "porcentaje" <= 999.9999));
ALTER TABLE "ProductoAdmiteOpcion" ADD CONSTRAINT "ProductoAdmiteOpcion_version_chk" CHECK ("version" >= 1);

ALTER TABLE "GrupoDeOpciones" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "GrupoDeOpciones"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "OpcionDeGrupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OpcionDeGrupo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "VersionDeOpcion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "VersionDeOpcion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ConsumoDeOpcion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ConsumoDeOpcion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ProductoAdmiteGrupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ProductoAdmiteGrupo"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ProductoAdmiteOpcion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ProductoAdmiteOpcion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ConsumoDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion" FROM motor2_app;
    GRANT SELECT, INSERT ON "GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ConsumoDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion" TO motor2_app;
    GRANT UPDATE ("nombre", "cantidadMinima", "cantidadMaxima", "activo", "version", "actualizadoEn") ON "GrupoDeOpciones" TO motor2_app;
    GRANT UPDATE ("nombre", "orden", "activa", "version", "actualizadoEn") ON "OpcionDeGrupo" TO motor2_app;
    GRANT UPDATE ("orden", "cantidadMinima", "cantidadMaxima", "modoPrecio", "activo", "version", "actualizadoEn") ON "ProductoAdmiteGrupo" TO motor2_app;
    GRANT UPDATE ("cantidadMaxima", "precioAbsoluto", "tipoDeDiferencia", "diferenciaPrecio", "porcentaje", "activo", "version", "actualizadoEn") ON "ProductoAdmiteOpcion" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ConsumoDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion" FROM motor2_plataforma;
  END IF;
END
$$;
