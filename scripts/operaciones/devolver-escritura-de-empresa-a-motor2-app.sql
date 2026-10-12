-- Reversa GRANULAR del recorte de "Empresa" (M.1, S-35 / M-10): le devuelve a `motor2_app` SOLO la escritura (INSERT, UPDATE, DELETE) sobre "Empresa", tal como la dejaba el GRANT masivo
-- de `crear-rol-motor2-app.sql` antes de `restringir`. NO borra el rol `motor2_plataforma` ni le toca un solo grant (para eso están `quitar-rol-motor2-plataforma.sql`, que además lo elimina, y
-- `revertir-recorte-de-grants-motor2-plataforma.sql`, que devuelve lo recortado a la consola): si el recorte rompió algo en producción, esta es la marcha atrás de UN paso, sin perder el rol ni su clave.
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR; paso manual, NO es una migración.
-- Idempotente: correrlo dos veces, o sin haber recortado nunca, no cambia nada. Para volver a recortar: `crear-rol-motor2-plataforma.sql -v restringir=1` (sin clave).
-- Uso (como dueño; atómico con `-1`, o con el ejecutor `scripts/operaciones/ejecutar-sql-de-psql.mjs`, que también va en una sola transacción y simula con `--simular`):
--   psql <conexión del dueño a la base> -1 -f scripts/operaciones/devolver-escritura-de-empresa-a-motor2-app.sql

\set ON_ERROR_STOP on

GRANT INSERT, UPDATE, DELETE ON "Empresa" TO motor2_app;

-- Verificación: los cuatro tienen que dar t (leer y escribir "Empresa" con el rol de la app).
SELECT has_table_privilege('motor2_app', 'public."Empresa"', 'SELECT') AS puede_leer,
       has_table_privilege('motor2_app', 'public."Empresa"', 'INSERT') AS puede_insertar,
       has_table_privilege('motor2_app', 'public."Empresa"', 'UPDATE') AS puede_actualizar,
       has_table_privilege('motor2_app', 'public."Empresa"', 'DELETE') AS puede_borrar;
