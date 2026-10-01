-- Migración de DATOS (no cambia el esquema): partición de las claves de permisos de los reportes (decisión del dueño, 2026-09-30: UNA
-- clave por reporte). Cada reporte pasa a tener su propia acción `reporte_*` en lugar de colgar de un grupo (`ver_reportes_dinero`,
-- `ver_reportes_control`, `ver_reportes_operativos`, `ver_reportes_catalogo`) o de otra acción prestada (`proceso_control` para Conteos,
-- `insumos_mezclados` para Huecos de catálogo).
--
-- Fase EXPANDIR: las acciones padre NO se borran acá (sus filas de `Accion`, `PermisoRol` y `CapacidadSucursal` quedan) para que un deploy
-- anterior siga funcionando; se retiran en una fase posterior, ya sin ningún código que las use. Mientras tanto la matriz solo muestra las
-- claves del catálogo vigente (`claveEnCatalogo`).
--
-- Cada empresa conserva su configuración: a cada rol (y a cada capacidad de sucursal) se le copia, para cada reporte, lo que ya tenía en la
-- acción padre. Se copia con el `empresaId` de la fila de origen (las migraciones corren como dueño de las tablas, sin RLS: no hay empresa
-- activa de la que tomar el default). Idempotente y sin pisar nada: lo que ya exista para (rol, acción) o (acción, sucursal) queda intacto.
-- Un reporte nuevo (`reporte_historial_importes`, los importes dentro del Historial de un producto) hereda de `ver_reportes_dinero`.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('reporte_resumen', 'Ver el reporte «Resumen operativo»'),
  ('reporte_consolidado', 'Ver el reporte «Consolidado (mis sucursales)»'),
  ('reporte_periodo', 'Ver el reporte «Período»'),
  ('reporte_categorias', 'Ver el reporte «Por categoría»'),
  ('reporte_ventas_por_seccion', 'Ver el reporte «Por sección de carta»'),
  ('reporte_costos', 'Ver el reporte «Costos y márgenes»'),
  ('reporte_compras', 'Ver el reporte «Compras registradas»'),
  ('reporte_rendimiento_recetas', 'Ver el reporte «Rendimiento real de recetas»'),
  ('reporte_rendimiento_sucursal', 'Ver el reporte «Rendimiento por sucursal»'),
  ('reporte_valuacion', 'Ver el reporte «Valuación de inventario»'),
  ('reporte_boletas', 'Ver el reporte «Boletas emitidas»'),
  ('reporte_descuentos_clientes', 'Ver el reporte «Descuentos por cliente»'),
  ('reporte_margen_promociones', 'Ver el reporte «Margen de promociones»'),
  ('reporte_historial_importes', 'Ver los importes (precios de compra y de venta) dentro del reporte «Historial de un producto»'),
  ('reporte_perdidas', 'Ver el reporte «Pérdidas»'),
  ('reporte_devoluciones', 'Ver el reporte «Devoluciones»'),
  ('reporte_diferencias', 'Ver el reporte «Diferencias de ajuste»'),
  ('reporte_vencimientos', 'Ver el reporte «Vencimientos»'),
  ('reporte_salud', 'Ver el reporte «Salud por producto»'),
  ('reporte_historial', 'Ver el reporte «Historial de un producto»'),
  ('reporte_trazabilidad', 'Ver el reporte «Trazabilidad por ID»'),
  ('reporte_rotacion_mesas', 'Ver el reporte «Rotación de mesas»'),
  ('reporte_sin_receta', 'Ver el reporte «Ventas sin receta»'),
  ('reporte_insumos_sin_receta', 'Ver el reporte «Insumos sin receta»'),
  ('reporte_conteos', 'Ver el reporte «Conteos físicos»'),
  ('reporte_huecos_catalogo', 'Ver el reporte «Huecos de catálogo»')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('ver_reportes_dinero', 'reporte_resumen'),
  ('ver_reportes_dinero', 'reporte_consolidado'),
  ('ver_reportes_dinero', 'reporte_periodo'),
  ('ver_reportes_dinero', 'reporte_categorias'),
  ('ver_reportes_dinero', 'reporte_ventas_por_seccion'),
  ('ver_reportes_dinero', 'reporte_costos'),
  ('ver_reportes_dinero', 'reporte_compras'),
  ('ver_reportes_dinero', 'reporte_rendimiento_recetas'),
  ('ver_reportes_dinero', 'reporte_rendimiento_sucursal'),
  ('ver_reportes_dinero', 'reporte_valuacion'),
  ('ver_reportes_dinero', 'reporte_boletas'),
  ('ver_reportes_dinero', 'reporte_descuentos_clientes'),
  ('ver_reportes_dinero', 'reporte_margen_promociones'),
  ('ver_reportes_dinero', 'reporte_historial_importes'),
  ('ver_reportes_control', 'reporte_perdidas'),
  ('ver_reportes_control', 'reporte_devoluciones'),
  ('ver_reportes_control', 'reporte_diferencias'),
  ('ver_reportes_operativos', 'reporte_vencimientos'),
  ('ver_reportes_operativos', 'reporte_salud'),
  ('ver_reportes_operativos', 'reporte_historial'),
  ('ver_reportes_operativos', 'reporte_trazabilidad'),
  ('ver_reportes_operativos', 'reporte_rotacion_mesas'),
  ('ver_reportes_catalogo', 'reporte_sin_receta'),
  ('ver_reportes_catalogo', 'reporte_insumos_sin_receta'),
  ('proceso_control', 'reporte_conteos'),
  ('insumos_mezclados', 'reporte_huecos_catalogo')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('ver_reportes_dinero', 'reporte_resumen'),
  ('ver_reportes_dinero', 'reporte_consolidado'),
  ('ver_reportes_dinero', 'reporte_periodo'),
  ('ver_reportes_dinero', 'reporte_categorias'),
  ('ver_reportes_dinero', 'reporte_ventas_por_seccion'),
  ('ver_reportes_dinero', 'reporte_costos'),
  ('ver_reportes_dinero', 'reporte_compras'),
  ('ver_reportes_dinero', 'reporte_rendimiento_recetas'),
  ('ver_reportes_dinero', 'reporte_rendimiento_sucursal'),
  ('ver_reportes_dinero', 'reporte_valuacion'),
  ('ver_reportes_dinero', 'reporte_boletas'),
  ('ver_reportes_dinero', 'reporte_descuentos_clientes'),
  ('ver_reportes_dinero', 'reporte_margen_promociones'),
  ('ver_reportes_dinero', 'reporte_historial_importes'),
  ('ver_reportes_control', 'reporte_perdidas'),
  ('ver_reportes_control', 'reporte_devoluciones'),
  ('ver_reportes_control', 'reporte_diferencias'),
  ('ver_reportes_operativos', 'reporte_vencimientos'),
  ('ver_reportes_operativos', 'reporte_salud'),
  ('ver_reportes_operativos', 'reporte_historial'),
  ('ver_reportes_operativos', 'reporte_trazabilidad'),
  ('ver_reportes_operativos', 'reporte_rotacion_mesas'),
  ('ver_reportes_catalogo', 'reporte_sin_receta'),
  ('ver_reportes_catalogo', 'reporte_insumos_sin_receta'),
  ('proceso_control', 'reporte_conteos'),
  ('insumos_mezclados', 'reporte_huecos_catalogo')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
