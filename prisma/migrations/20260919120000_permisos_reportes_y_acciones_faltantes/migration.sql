-- Migración de DATOS (no cambia el esquema): agrega al catálogo de acciones y a la matriz de permisos de `admin`
-- (a) las cuatro claves de reportes por grupo de sensibilidad (ver src/core/permisos/acciones.ts) y
-- (b) tres acciones que el código ya usa pero que una base creada antes de agregarlas nunca recibió
--     (`anular_venta`, `pagar_consignante`, `ver_auditoria`): sin su fila en la matriz, ni el admin puede usarlas.
--
-- Idempotente: no pisa nada. `ON CONFLICT DO NOTHING` deja intacta una acción o un permiso que ya exista (por ejemplo una
-- matriz que el usuario ya ajustó a mano). Solo admin recibe filas: el resto de los roles queda «sin asignar» (ni Ver ni Editar),
-- que es lo mismo que no tener fila; se configura desde la matriz de permisos.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('anular_venta', 'Anular una venta ya confirmada'),
  ('pagar_consignante', 'Registrar un pago a un proveedor de consignación'),
  ('ver_auditoria', 'Ver el registro de auditoría administrativa (precios y permisos)'),
  ('ver_reportes_dinero', 'Ver los reportes de dinero: resumen, consolidado, período, por categoría, costos y márgenes, valuación y rendimiento de recetas'),
  ('ver_reportes_control', 'Ver los reportes de control: pérdidas y consumo interno, devoluciones y diferencias de ajuste'),
  ('ver_reportes_operativos', 'Ver los reportes operativos: vencimientos, salud por producto, historial de un producto y trazabilidad'),
  ('ver_reportes_catalogo', 'Ver los reportes de calidad del catálogo: insumos sin receta y ventas sin receta')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES
  ('anular_venta'),
  ('pagar_consignante'),
  ('ver_auditoria'),
  ('ver_reportes_dinero'),
  ('ver_reportes_control'),
  ('ver_reportes_operativos'),
  ('ver_reportes_catalogo')
) AS a("clave")
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
