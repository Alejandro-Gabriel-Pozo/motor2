-- Extensiones de Postgres para módulos que vienen: btree_gist, pg_trgm y unaccent. NO crea tablas ni toca datos.
--
-- POR QUÉ: hay tres reglas que la base puede garantizar mejor que el código y que necesitan estas extensiones.
--   * btree_gist: permite `EXCLUDE USING gist (empresaId WITH =, recurso WITH =, periodo WITH &&)`, o sea «para el mismo recurso, sin períodos
--     superpuestos»: reservas, turnos de caja, tarifas por temporada, precios programados. Ninguna carrera entre dos pedidos simultáneos la saltea.
--     También deja combinar `empresaId` con un rango o con una búsqueda por similitud en un solo índice GiST.
--   * pg_trgm: búsqueda tolerante a errores de tipeo (similitud por trigramas) para productos y clientes.
--   * unaccent: búsqueda tolerante a acentos («jamon» encuentra «Jamón»).
-- Las tres son extensiones «de confianza» (trusted): las puede crear el dueño de la base sin ser superusuario, también en Neon.
--
-- QUÉ NO HACE: no cambia ningún comportamiento de la aplicación. Cada extensión se usa recién cuando una migración posterior cree el primer
-- índice o regla que la necesite. Es idempotente (IF NOT EXISTS) y se corre con el rol dueño (el que migra: DIRECT_URL), en el esquema `public`.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
