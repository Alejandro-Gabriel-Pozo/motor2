-- Reversa de 20261001220000_margen_objetivo: se pierden los objetivos cargados (es dato nuevo de esta fase); vuelve a regir la constante.
DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'margen_objetivo_editar';
DELETE FROM "PermisoRol" WHERE "accionClave" = 'margen_objetivo_editar';
DELETE FROM "Accion" WHERE "clave" = 'margen_objetivo_editar';

DROP POLICY IF EXISTS aislamiento_empresa ON "MargenObjetivo";
DROP TABLE "MargenObjetivo";
