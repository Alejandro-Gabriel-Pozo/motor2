-- Verificación de 20261117150000_ocultamiento_id_uuid_nativo (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: `id` es text y existe el CHECK `OcultamientoProducto_id_uuid_chk`. DESPUÉS: `id` es uuid y el CHECK no existe. En los dos casos: cuántas marcas hay y si alguna tiene un id que no sea uuid (si hay, la migración abortaría).
SELECT data_type::text AS tipo_de_id FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OcultamientoProducto' AND column_name = 'id';
SELECT conname::text FROM pg_constraint WHERE conrelid = to_regclass('public."OcultamientoProducto"') AND conname = 'OcultamientoProducto_id_uuid_chk';
SELECT count(*) AS marcas FROM "OcultamientoProducto";
SELECT count(*) AS ids_que_no_son_uuid FROM "OcultamientoProducto" WHERE "id"::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
SELECT indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'OcultamientoProducto' ORDER BY 1;
