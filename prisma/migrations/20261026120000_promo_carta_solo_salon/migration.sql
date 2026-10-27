-- INTERRUPTOR «SOLO SALÓN» de las promociones (docs/diseno-promo-solo-salon-2026-10-26.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- `PromoCarta.soloSalon`: la promo (de la EMPRESA, como todo `PromoCarta`) que se vende desde el POS pero NO aparece en la carta pública (web, QR ni impresa): útil para un menú pactado con una empresa, cuyo
-- precio no debe quedar publicado ni indexado. Apagado (default): la promo se ofrece como hasta hoy. Lo lee el embudo único `wherePromoOfrecidaEn(sucursalId, audiencia)` (`core/carta/promo-sucursal.ts`).
-- ADITIVA: el default constante (`false`) solo toca el catálogo (PG >= 11) y deja cada promo existente como se ve hoy (visible en la carta pública); el código anterior no lee ni escribe la columna (sus `data`
-- son explícitos y los INSERT toman el default). Sin CHECK, políticas ni GRANT nuevos: la política `aislamiento_empresa` de `PromoCarta` es por fila y `motor2_app` tiene los privilegios de TABLA (sin
-- privilegios por columna), que cubren la columna nueva.
-- ORDEN DE DESPLIEGUE: esta migración va ANTES que el código (el código nuevo lee la columna: sin ella Prisma falla al leer `PromoCarta`); el código viejo con la columna nueva no se entera.
-- Reversa: down.sql (a mano, como dueño; ABORTA si alguna promo tiene el interruptor prendido; después marcarla revertida en `_prisma_migrations`: ver el pie de down.sql).

ALTER TABLE "PromoCarta" ADD COLUMN "soloSalon" BOOLEAN NOT NULL DEFAULT false;
