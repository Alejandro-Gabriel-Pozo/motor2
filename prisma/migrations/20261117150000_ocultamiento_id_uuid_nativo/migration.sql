-- «Ocultar» como Pedernal: el id de `OcultamientoProducto` pasa de TEXT + CHECK de forma uuid a `UUID` nativo (molde de tabla nueva del frente 3: `docs/diseno-datos-paridad-pedernal-2026-11-16.md`, decisión N4-3;
-- decisión técnica del orquestador general, 2026-11-16, `motor2-docs` «Fase 1 de los frentes»). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo).
--
-- QUÉ: el tipo de UNA columna (`id`) de una tabla que todavía no se aplicó a ninguna base real. La app sigue mandando el id (`azar.uuid()`): como Prisma lo ve como String con `@db.Uuid`, el código no cambia. El CHECK
-- `OcultamientoProducto_id_uuid_chk` sobra (el tipo ya impide un valor que no sea uuid) y se saca. La clave primaria y el único `(empresaId, id)` se reconstruyen solos con el tipo nuevo. Nada más cambia.
-- Es COMPATIBLE HACIA ATRÁS para el código anterior: no lee ni escribe esta tabla.
--
-- Cuidado: `USING "id"::uuid` falla si alguna fila tuviera un id que no es uuid. No puede pasar (el CHECK de la migración 20261115120000 lo impedía); si pasara, la migración aborta entera (es una sola transacción) y no deja nada a medias.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117150000_ocultamiento_id_uuid_nativo`). No pierde datos: el uuid se escribe en minúsculas, como lo exige el CHECK.

ALTER TABLE "OcultamientoProducto" DROP CONSTRAINT IF EXISTS "OcultamientoProducto_id_uuid_chk";
ALTER TABLE "OcultamientoProducto" ALTER COLUMN "id" TYPE UUID USING "id"::uuid;
