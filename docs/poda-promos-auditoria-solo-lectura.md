# Poda de promos: auditoría previa por base (solo lectura)

Diseño: `docs/diseno-poda-promos-2026-11-12.md` §7. Es la consulta que hay que correr en CADA base (principal, `zuluhub-demo` y toda otra con datos) antes de desplegar el tiempo 1 y antes de aplicar el tiempo 2. Se pega como dueño de la base; la transacción es `READ ONLY` (si hubiera una escritura por error, la base la rechaza). El resultado se pega en el PR del tiempo; si una cifra marcada «DEBE SER 0» no es 0, se frena y se le pregunta al dueño. Probada contra una base local vacía (todas las cifras en 0).

```sql
-- Poda de promos — auditoría previa por base (SOLO LECTURA).
-- Diseño: docs/diseno-poda-promos-2026-11-12.md §7. Es la consulta que hay que correr en CADA base (principal, zuluhub-demo y toda otra con datos)
-- ANTES de desplegar el tiempo 1 (el código ya no mira la vigencia ni el plato del día) y ANTES de aplicar el tiempo 2 (la migración que borra columnas y tabla).
-- Cómo: abrir una sesión SQL como dueño de la base y pegar todo. La transacción es READ ONLY: si por error hubiera una escritura, la base la rechaza.
-- Qué hacer con el resultado: pegar las cifras en el PR del tiempo. Si alguna cifra de las marcadas «DEBE SER 0» no es 0, SE FRENA y se le pregunta al dueño
-- qué hacer con esas promos (no se decide acá).

BEGIN READ ONLY;

-- 1. Vigencia en uso. Con el código nuevo, una promo con fechas o días cargados pasa a ofrecerse SIEMPRE (la vigencia ya no se mira): DEBE SER 0 promos_con_vigencia.
SELECT count(*) FILTER (WHERE "vigenteDesde" IS NOT NULL OR "vigenteHasta" IS NOT NULL OR "diasDeSemana" IS NOT NULL) AS promos_con_vigencia,
       count(*) AS promos_total
FROM "PromoCarta";

-- 1b. Cuáles son (para decidir con el dueño: dejarlas siempre ofrecidas, apagarlas o ajustar su fecha a mano).
SELECT "id", "titulo", "activa", "vigenteDesde", "vigenteHasta", "diasDeSemana"
FROM "PromoCarta"
WHERE "vigenteDesde" IS NOT NULL OR "vigenteHasta" IS NOT NULL OR "diasDeSemana" IS NOT NULL
ORDER BY "titulo", "id";

-- 2. Menú del día en uso. DEBEN SER 0 los dos. Un lugar «del día» activo hace que su promo NO se ofrezca (el código nuevo falla cerrado).
SELECT (SELECT count(*) FROM "EntradaDelDiaDeCupo") AS platos_del_dia,
       (SELECT count(*) FROM "PromoCartaCupo" WHERE "tipo" = 'DEL_DIA') AS cupos_del_dia,
       (SELECT count(*) FROM "PromoCartaCupo" WHERE "tipo" = 'DEL_DIA' AND "activo") AS cupos_del_dia_activos;

-- 2b. Cuáles son (promo, lugar y cuántos platos cargados tiene).
SELECT p."id" AS promo_id, p."titulo", c."id" AS cupo_id, c."nombre" AS lugar, c."activo",
       (SELECT count(*) FROM "EntradaDelDiaDeCupo" e WHERE e."cupoId" = c."id") AS platos_cargados
FROM "PromoCartaCupo" c
JOIN "PromoCarta" p ON p."id" = c."promoCartaId"
WHERE c."tipo" = 'DEL_DIA'
ORDER BY p."titulo", c."orden", c."id";

-- 3. Permiso del menú del día: quién lo tiene (informativo; se borra en el tiempo 2).
SELECT count(*) AS filas_permiso FROM "PermisoRol" WHERE "accionClave" = 'promo_menu_del_dia';

-- 4. Lo que se CONSERVA (no se toca en ningún tiempo): cuánto hay vendido con promos. Informativo.
SELECT count(*) AS promos_vendidas FROM "PromoCuenta";

-- 5. Filas históricas de la auditoría que nombran la vigencia o el plato del día (se CONSERVAN: la auditoría solo se agrega). Informativo.
SELECT "entidad", "campo", count(*) AS filas
FROM "RegistroAuditoria"
WHERE ("entidad" = 'PromoCarta' AND "campo" IN ('vigenteDesde', 'vigenteHasta', 'diasDeSemana'))
   OR "entidad" = 'EntradaDelDiaDeCupo'
GROUP BY "entidad", "campo"
ORDER BY "entidad", "campo";

ROLLBACK;
```
