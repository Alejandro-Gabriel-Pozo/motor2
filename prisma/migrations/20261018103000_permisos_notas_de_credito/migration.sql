-- Migración de DATOS (no cambia el esquema) — Paquete 4, M6.4 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alta de las TRES claves de permiso de la NOTA DE CRÉDITO DE PROVEEDOR y su siembra al rol `admin` de cada empresa
-- (Decisión 3 del dueño: de fábrica las tiene el administrador, igual que `anular_compra` y `gasto_anular`; con el piso administrador nadie más las puede tener).
--
--   nota_credito_proveedor         compras  sucursal  piso administrador  clase A  semilla admin   registrar una nota de crédito de proveedor sobre mercadería de la sucursal
--   gasto_nota_credito             gastos   sucursal  piso administrador  clase A  semilla admin   registrar una nota de crédito de proveedor sobre un gasto de la sucursal
--   anular_nota_credito_proveedor  compras  sucursal  piso administrador  clase A  semilla admin   anular una nota de crédito de proveedor de la sucursal (sirve para las dos naturalezas)
--
-- EN LA BASE DESDE M6, EN EL CATÁLOGO RECIÉN EN LA ETAPA C: las claves NO están todavía en `ACCIONES` (src/core/permisos/acciones.ts), igual que las siete de los gastos de M4.5 (el módulo `gastos` está «en desarrollo» y la matriz de permisos las mostraría en TODAS las empresas). Una clave
-- que está en la base y no en el catálogo queda oculta y no se puede editar, que es lo que se quiere hasta que exista el caso de uso. Mientras tanto `test/permisos/paridad-catalogo-migraciones.test.ts` las declara en `RESERVADAS_EN_BASE`, con su motivo y su descripción
-- DEFINITIVA (la de abajo: la compara después con la de `ACCIONES`). Esta migración NO cambia ningún comportamiento por sí sola.
--
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas, así que se puede aplicar antes del deploy sin romper nada. Sin copia desde otras claves y sin `CapacidadSucursal` (una acción sin fila de capacidad está habilitada en toda sucursal). Se inserta con el `empresaId`
-- de la fila del rol: la migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto de empresa, así que el default de la columna no sirve. El `ON CONFLICT` no pisa una fila ya configurada.
--
-- ATENCIÓN: una empresa que se dé de alta DESPUÉS de esta migración y ANTES de la Etapa C no recibe las tres filas del admin (el alta siembra desde `ACCIONES`, y las claves todavía no están ahí): se cubre volviendo a correr el segundo INSERT, que es idempotente
-- (con su propia autorización). Antes se mira con: SELECT r."empresaId" FROM "Rol" r WHERE r."clave" = 'admin' AND NOT EXISTS (SELECT 1 FROM "PermisoRol" p WHERE p."rolId" = r."id" AND p."accionClave" = 'nota_credito_proveedor');
--
-- Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano sobre las tres claves).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('nota_credito_proveedor', 'Registrar una nota de crédito de proveedor sobre mercadería de la sucursal'),
  ('gasto_nota_credito', 'Registrar una nota de crédito de proveedor sobre un gasto de la sucursal'),
  ('anular_nota_credito_proveedor', 'Anular una nota de crédito de proveedor de la sucursal')
ON CONFLICT ("clave") DO NOTHING;

-- El rol administrador de sistema de cada empresa (por su clave estable, no por el nombre): las tres claves.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", k.clave, true, true
FROM "Rol" r
CROSS JOIN (VALUES ('nota_credito_proveedor'), ('gasto_nota_credito'), ('anular_nota_credito_proveedor')) AS k(clave)
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
