-- GO-1a, migración de DATOS (no cambia el esquema) (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): las TRES claves de permiso de los grupos de opciones de venta (el «elemento configurable») y su siembra al rol `admin` de cada empresa.
--   opciones_definir             empresa    piso administrador  semilla admin   definir los grupos de opciones de venta y sus opciones
--   producto_opciones_admitidas  empresa    piso administrador  semilla admin   elegir qué grupos y opciones de venta admite cada producto
--   opcion_apagar_en_sucursal    sucursal   piso operario       semilla admin   apagar o prender una opción de venta en la sucursal
-- Como la migración de los gastos (M4.5) y la de los centros de costos (M7.4): las claves viven en la base desde GO-1 y entran a `ACCIONES` recién en GO-2, con su guarda y su caso de uso. Una clave que está en la base y no en el catálogo queda oculta y no se puede editar, que es lo que se quiere hasta entonces.
-- Sin copia desde otras claves y sin `CapacidadSucursal` (una acción sin fila de capacidad está habilitada en toda sucursal). El `empresaId` de cada fila nueva sale de la fila del rol: la migración corre como dueño (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto de empresa. `ON CONFLICT` no pisa lo que el gerente ya tocó.
-- Una empresa que nace entre GO-1 y GO-2 no recibe las filas (el alta siembra desde `ACCIONES`, y las claves todavía no están ahí): volver a correr el 2.º INSERT (idempotente) con su propia autorización. Antes se mira con:
--   SELECT r."empresaId" FROM "Rol" r WHERE r."clave" = 'admin' AND NOT EXISTS (SELECT 1 FROM "PermisoRol" p WHERE p."rolId" = r."id" AND p."accionClave" = 'opciones_definir');
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas. Idempotente.
-- Reversa: down.sql, ABORTA si la configuración cambió (delegaciones, cambios del admin o capacidades por sucursal sobre estas claves); con la semilla pura borra las tres claves y sus filas.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('opciones_definir', 'Definir los grupos de opciones de venta y sus opciones'),
  ('producto_opciones_admitidas', 'Elegir qué grupos y opciones de venta admite cada producto'),
  ('opcion_apagar_en_sucursal', 'Apagar o prender una opción de venta en la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", k.clave, true, true
FROM "Rol" r
CROSS JOIN (VALUES ('opciones_definir'), ('producto_opciones_admitidas'), ('opcion_apagar_en_sucursal')) AS k(clave)
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
