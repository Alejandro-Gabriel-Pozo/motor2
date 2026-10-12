-- Migración de DATOS (no cambia el esquema) — Paquete 3, M4.5 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alta de las SIETE claves de permiso de los GASTOS (D1 y D4 del dueño: se llaman `gasto_*`, no `servicio_*`;
-- un servicio no es un producto, es un concepto de gasto) y su siembra al rol `admin` de cada empresa.
--
--   gasto_ver               sucursal  piso administrador  semilla admin   ver los gastos de la sucursal
--   gasto_registrar         sucursal  piso administrador  semilla admin   registrar un gasto (renglón sin stock de la factura de proveedor)
--   gasto_anular            sucursal  piso administrador  semilla admin   anular un gasto
--   gasto_reclasificar      sucursal  piso administrador  semilla admin   reclasificar el tipo de costo de un gasto (la tabla de la reclasificación llega con M5; la clave se da de alta ya, sin costo)
--   gasto_repartir          empresa   piso administrador  SIN semilla     repartir un gasto entre sucursales: NADIE la recibe; el dueño la delega a quien quiera
--   conceptos_gasto         empresa   piso administrador  semilla admin   administrar el catálogo de conceptos de gasto
--   reporte_gastos_empresa  empresa   piso administrador  semilla admin   ver el reporte de gastos de toda la empresa
--
-- EN LA BASE DESDE M4, EN EL CATÁLOGO RECIÉN EN LA ETAPA C: las claves NO están todavía en `ACCIONES` (src/core/permisos/acciones.ts): el módulo `gastos` está «en desarrollo» y un guardián (test/arquitectura/acciones-con-modulo.test.ts) prohíbe acciones de un
-- módulo en desarrollo; además la matriz de permisos las mostraría en TODAS las empresas. Una clave que está en la base y no en el catálogo queda oculta y no se puede editar, que es lo que se quiere hasta que exista el caso de uso. Entran a `ACCIONES` en la Etapa C,
-- con su guarda; mientras tanto `test/permisos/paridad-catalogo-migraciones.test.ts` las declara en `RESERVADAS_EN_BASE`, con su motivo y su descripción DEFINITIVA (la de abajo: la compara después con la de `ACCIONES`). Esta migración NO cambia ningún comportamiento por sí sola.
--
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas, así que se puede aplicar antes del deploy sin romper nada. Sin copia desde otras claves (nadie carga gastos hoy, así que nadie pierde nada; no se copia de `proceso_compra`) y sin `CapacidadSucursal`
-- (una acción sin fila de capacidad está habilitada en toda sucursal). Se inserta con el `empresaId` de la fila del rol: la migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto de empresa, así que el default de la columna no sirve.
-- El `ON CONFLICT` no pisa una fila ya configurada.
--
-- ATENCIÓN: una empresa que se dé de alta DESPUÉS de esta migración y ANTES de la Etapa C no recibe las seis filas del admin (el alta siembra desde `ACCIONES`, y las claves todavía no están ahí): se cubre volviendo a correr el segundo INSERT, que es idempotente
-- (con su propia autorización). Antes se mira con: SELECT r."empresaId" FROM "Rol" r WHERE r."clave" = 'admin' AND NOT EXISTS (SELECT 1 FROM "PermisoRol" p WHERE p."rolId" = r."id" AND p."accionClave" = 'gasto_ver');
--
-- Idempotente. Reversa: down.sql (a mano, como dueño; DESTRUCTIVA: borra la configuración de las siete claves).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('gasto_ver', 'Ver los gastos de la sucursal'),
  ('gasto_registrar', 'Registrar un gasto en la sucursal'),
  ('gasto_anular', 'Anular un gasto de la sucursal'),
  ('gasto_reclasificar', 'Reclasificar el tipo de costo de un gasto de la sucursal'),
  ('gasto_repartir', 'Repartir un gasto entre sucursales'),
  ('conceptos_gasto', 'Administrar el catálogo de conceptos de gasto'),
  ('reporte_gastos_empresa', 'Ver el reporte de gastos de toda la empresa')
ON CONFLICT ("clave") DO NOTHING;

-- El rol administrador de sistema de cada empresa (por su clave estable, no por el nombre): las seis claves con semilla. `gasto_repartir` no se siembra a nadie.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", k.clave, true, true
FROM "Rol" r
CROSS JOIN (VALUES ('gasto_ver'), ('gasto_registrar'), ('gasto_anular'), ('gasto_reclasificar'), ('conceptos_gasto'), ('reporte_gastos_empresa')) AS k(clave)
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
