-- Migración de DATOS (no cambia el esquema): partición de las claves de permisos de stock, conteo, promociones, POS y catálogo (decisión del
-- dueño, 2026-09-30: UNA clave por acción). Cada acción que colgaba de la clave de otra pasa a tener la suya.
--
-- Fase EXPANDIR: las claves padre NO se borran (siguen con sus filas de `Accion`, `PermisoRol` y `CapacidadSucursal`) y el código deja de
-- usarlas para estas acciones. Quienes ya podían hacer la acción siguen pudiendo: a cada rol (y a cada capacidad de sucursal) se le copia, para
-- cada clave nueva, lo que ya tenía en el padre. Se copia con el `empresaId` de la fila de origen (la migración corre como dueño, sin RLS: no hay
-- empresa activa de la que tomar el default). Idempotente y sin pisar nada: lo que ya exista para (rol, acción) o (acción, sucursal) queda intacto.
-- Los padres cuyo alcance se achicó cambian de descripción (UPDATE al final).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('stock_seccion_habitual', 'Fijar la Sección habitual de cada producto'),
  ('pos_emitir_boleta_corregida', 'Emitir la boleta corregida de una cuenta ya cerrada (POS)'),
  ('insumo_renombrar_fusionar', 'Renombrar un insumo o fusionarlo con otro'),
  ('conteo_resolver_pendiente', 'Resolver un conteo físico pendiente de revisión'),
  ('stock_reclasificar', 'Reclasificar stock: repartir el saldo de un producto entre otras secciones y lotes'),
  ('conteo_frecuencia', 'Fijar cada cuántos días se cuenta cada producto (Frecuencia de conteo)'),
  ('promociones_activar', 'Activar o desactivar las Promociones de la sucursal'),
  ('promociones_marcar_combo', 'Marcar un producto como Combo'),
  ('producto_ver_catalogo', 'Ver el catálogo de productos y la ficha de cada uno'),
  ('producto_presentaciones', 'Agregar y activar o desactivar presentaciones alternativas de un producto'),
  ('insumo_alta', 'Dar de alta un insumo'),
  ('categoria_alta', 'Dar de alta una categoría de producto'),
  ('proveedor_alta', 'Dar de alta un proveedor'),
  ('producto_disponibilidad', 'Marcar un producto como disponible o no disponible'),
  ('pos_alta_mesa', 'Dar de alta mesas en el salón (POS)'),
  ('pos_limite_mesas_abiertas', 'Fijar el límite de mesas abiertas a la vez (POS)'),
  ('pos_abrir_cuenta', 'Abrir la cuenta de una mesa y corregir sus comensales (POS)'),
  ('pos_enviar_a_cocina', 'Enviar a cocina los ítems de una cuenta (POS)'),
  ('pos_liberar_mesa', 'Liberar una mesa abierta que no tuvo consumo (POS)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('stock_minimo', 'stock_seccion_habitual'),
  ('pos_cerrar_cuenta', 'pos_emitir_boleta_corregida'),
  ('grupos_familia', 'insumo_renombrar_fusionar'),
  ('proceso_control', 'conteo_resolver_pendiente'),
  ('proceso_control', 'stock_reclasificar'),
  ('proceso_control', 'conteo_frecuencia'),
  ('promociones_config', 'promociones_activar'),
  ('promociones_config', 'promociones_marcar_combo'),
  ('alta_producto', 'producto_ver_catalogo'),
  ('alta_producto', 'producto_presentaciones'),
  ('alta_producto', 'insumo_alta'),
  ('alta_producto', 'categoria_alta'),
  ('alta_producto', 'proveedor_alta'),
  ('editar_producto', 'producto_disponibilidad'),
  ('pos_mesas', 'pos_alta_mesa'),
  ('pos_mesas', 'pos_limite_mesas_abiertas'),
  ('pos_tomar_pedido', 'pos_abrir_cuenta'),
  ('pos_tomar_pedido', 'pos_enviar_a_cocina'),
  ('pos_tomar_pedido', 'pos_liberar_mesa')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('stock_minimo', 'stock_seccion_habitual'),
  ('pos_cerrar_cuenta', 'pos_emitir_boleta_corregida'),
  ('grupos_familia', 'insumo_renombrar_fusionar'),
  ('proceso_control', 'conteo_resolver_pendiente'),
  ('proceso_control', 'stock_reclasificar'),
  ('proceso_control', 'conteo_frecuencia'),
  ('promociones_config', 'promociones_activar'),
  ('promociones_config', 'promociones_marcar_combo'),
  ('alta_producto', 'producto_ver_catalogo'),
  ('alta_producto', 'producto_presentaciones'),
  ('alta_producto', 'insumo_alta'),
  ('alta_producto', 'categoria_alta'),
  ('alta_producto', 'proveedor_alta'),
  ('editar_producto', 'producto_disponibilidad'),
  ('pos_mesas', 'pos_alta_mesa'),
  ('pos_mesas', 'pos_limite_mesas_abiertas'),
  ('pos_tomar_pedido', 'pos_abrir_cuenta'),
  ('pos_tomar_pedido', 'pos_enviar_a_cocina'),
  ('pos_tomar_pedido', 'pos_liberar_mesa')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);

UPDATE "Accion" SET "descripcion" = 'Administrar los Grupos de insumos, asignar cada insumo a su Grupo y activar o desactivar insumos' WHERE "clave" = 'grupos_familia';

UPDATE "Accion" SET "descripcion" = 'Ver la pantalla de Promociones' WHERE "clave" = 'promociones_config';

UPDATE "Accion" SET "descripcion" = 'Ver el mapa de mesas del salón y entrar a la mesa (POS)' WHERE "clave" = 'pos_mesas';

UPDATE "Accion" SET "descripcion" = 'Tomar pedidos en el salón: agregar y quitar ítems sin enviar (POS)' WHERE "clave" = 'pos_tomar_pedido';
