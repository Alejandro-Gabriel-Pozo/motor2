-- Reversa de 20261117150000_ocultamiento_id_uuid_nativo («Ocultar», id uuid nativo). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117150000_ocultamiento_id_uuid_nativo`.
-- No pierde datos: el uuid se vuelve texto en minúsculas (lo que pedía el CHECK que se repone). Bajarla dos veces no falla: si el id ya es TEXT, el cambio de tipo no hace nada y el CHECK se repone solo una vez.
ALTER TABLE "OcultamientoProducto" ALTER COLUMN "id" TYPE TEXT USING "id"::text;
ALTER TABLE "OcultamientoProducto" DROP CONSTRAINT IF EXISTS "OcultamientoProducto_id_uuid_chk";
ALTER TABLE "OcultamientoProducto" ADD CONSTRAINT "OcultamientoProducto_id_uuid_chk" CHECK ("id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
