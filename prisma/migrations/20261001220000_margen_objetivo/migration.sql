-- Margen objetivo configurable (decisión del dueño, 2026-10-01; schema autorizado expresamente): el food cost objetivo (tope de la porción del precio de
-- carta neto que puede irse en comida y bebida) deja de ser solo una constante. Una fila de empresa (categoriaId NULL) y, opcionalmente, una por
-- categoría de producto; sin filas rige la constante. Lo edita SOLO administración. Reversa: down.sql.
--
-- 1) Tabla nueva `MargenObjetivo` (multiempresa como el resto: "empresaId" con default app_empresa_actual() y política aislamiento_empresa).
--    A mano (Prisma no los declara): índice único parcial para UNA sola fila de empresa y CHECK 0 < objetivo < 100.
-- 2) Permisos (datos): clave nueva `margen_objetivo_editar` (contexto empresa). Expandir: a cada rol se le copia lo que ya tenía en `categorias`
--    (el padre sigue en el catálogo). La clave exige nivel administrador: ningún operario la alcanza aunque la tuviera asignada.

-- CreateTable
CREATE TABLE "MargenObjetivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "categoriaId" TEXT,
    "foodCostObjetivoPct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "MargenObjetivo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MargenObjetivo_foodCostObjetivoPct_rango_check" CHECK ("foodCostObjetivoPct" > 0 AND "foodCostObjetivoPct" < 100)
);

-- CreateIndex
CREATE UNIQUE INDEX "MargenObjetivo_empresaId_id_key" ON "MargenObjetivo"("empresaId", "id");
CREATE UNIQUE INDEX "MargenObjetivo_empresaId_categoriaId_key" ON "MargenObjetivo"("empresaId", "categoriaId");
-- Postgres trata NULL como distinto de NULL en un UNIQUE normal: sin este índice parcial podría haber dos filas "de toda la empresa".
CREATE UNIQUE INDEX "MargenObjetivo_empresaId_default_key" ON "MargenObjetivo"("empresaId") WHERE "categoriaId" IS NULL;

-- AddForeignKey
ALTER TABLE "MargenObjetivo" ADD CONSTRAINT "MargenObjetivo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MargenObjetivo" ADD CONSTRAINT "MargenObjetivo_empresaId_categoriaId_fkey" FOREIGN KEY ("empresaId", "categoriaId") REFERENCES "CategoriaProducto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aislamiento por empresa (RLS)
ALTER TABLE "MargenObjetivo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "MargenObjetivo" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Permisos para el rol de ejecución, si existe (los default privileges del dueño ya lo cubren; esto lo deja explícito).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MargenObjetivo" TO motor2_app;
  END IF;
END
$$;

-- Permisos (datos): clave nueva `margen_objetivo_editar`.
INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('margen_objetivo_editar', 'Fijar el food cost objetivo de la empresa y de cada categoría')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('categorias', 'margen_objetivo_editar')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('categorias', 'margen_objetivo_editar')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
