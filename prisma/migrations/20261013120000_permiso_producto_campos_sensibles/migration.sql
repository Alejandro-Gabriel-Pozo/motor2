-- Migración de DATOS (no cambia el esquema): alta de la clave fina `producto_campos_sensibles` (M.2, P1; decisión del dueño, 2026-10-10).
-- Hoy cualquiera con `producto_editar` puede cambiar el precio de venta, el factor de conversión y las unidades de un producto, y cualquiera con
-- `producto_presentaciones` puede crear una presentación NUEVA con el factor que quiera. La clave fina separa esos campos del resto de la edición: se SUMA a las
-- dos anteriores (no las reemplaza) y solo se pide cuando el cambio toca uno de esos campos.
--
-- Fase EXPANDIR y aditiva: el código anterior ignora la clave nueva, así que se puede aplicar antes del deploy sin romper nada. Esta migración NO cambia ningún
-- comportamiento por sí sola: lo cambian los pasos siguientes de M.2 (P2 a P5), y para entonces cada rol ya tiene lo que tenía.
--
-- D-1 = COPIAR: a todo rol que HOY edita `producto_editar` o `producto_presentaciones` (los dos caminos que escriben esos campos) se le da la clave nueva con
-- Ver y Editar. Quien podía cambiar un precio o un factor el día anterior puede el día siguiente; la restricción llega cuando el dueño le quite la clave a un
-- rol, a propósito y a la vista. Además se la damos al rol de clave de sistema `admin` de cada empresa por si le faltara alguna de las dos filas de origen.
--
-- Se copia con el `empresaId` de la fila de origen: la migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto de empresa, así que
-- el default de la columna no sirve. Un rol aparece una sola vez aunque edite las dos claves (GROUP BY). El `ON CONFLICT` no pisa una fila ya configurada.
--
-- NO se copia `CapacidadSucursal` (a propósito): una acción sin fila de capacidad está HABILITADA en toda sucursal, y la clave nueva no tiene un «apagado» que
-- heredar; copiar el de `producto_editar` sería inventar una restricción que nadie pidió.
--
-- Idempotente. Reversa: down.sql (a mano, como dueño).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('producto_campos_sensibles', 'Cambiar el precio de venta, el factor de conversión y las unidades de un producto, y definir el factor de sus presentaciones de compra')
ON CONFLICT ("clave") DO NOTHING;

-- Todo rol que hoy EDITA producto_editar o producto_presentaciones (una sola fila por rol).
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", 'producto_campos_sensibles', true, true
FROM "PermisoRol" p
WHERE p."accionClave" IN ('producto_editar', 'producto_presentaciones') AND p."puedeEditar" = true
GROUP BY p."empresaId", p."rolId"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

-- El rol administrador de sistema de cada empresa (por su clave estable, no por el nombre), por si no tenía ninguna de las dos filas de origen.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'producto_campos_sensibles', true, true
FROM "Rol" r
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
