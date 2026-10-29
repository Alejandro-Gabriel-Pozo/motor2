-- «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29: «plato por plato»; diseño `docs/diseno-ocultar-grupo-en-carta-2026-10-29.md`; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base,
-- con respaldo y ensayo en una rama de Neon): `ProductoAdmiteGrupo.seMuestraEnCarta`, el interruptor por producto Y por grupo que decide si la carta (pública, impresa, vista previa y «Va a mostrar») lee ese
-- grupo en ese producto. BOOLEAN NOT NULL DEFAULT true = «se muestra»: cada fila existente queda como se ve hoy. La carta solo lo respeta si además el grupo no cambia el precio en el producto (regla pura
-- `seOcultaEnLaCarta`, `core/opciones/lectura-en-carta.ts`): la columna guarda la decisión del dueño, nunca el resultado. NO entra al POS, al ticket, al stock ni a los reportes.
-- Sin CHECK: que el grupo no cambie el precio depende de otras tablas (opciones, versiones, grilla del producto) y lo valida el comando de admisión sobre el estado resultante.
-- ADITIVA: el default constante solo toca el catálogo (PG >= 11); el código anterior no lee ni escribe la columna (sus `data` son explícitos y los INSERT toman el default). Sin políticas nuevas:
-- `aislamiento_empresa` es por fila y cubre la columna.
-- GRANT: `ProductoAdmiteGrupo` tiene privilegios de UPDATE POR COLUMNA para `motor2_app` (GO-1b, y `ejeDeCombinacion` de GO-3a): la columna nueva necesita el suyo (sin él, el formulario da 42501). Condicional al rol, como GO-1b.
-- Reversa: down.sql (a mano, como dueño; ABORTA si algún producto tiene un grupo apagado en la carta; después marcarla revertida en `_prisma_migrations`: ver el pie de down.sql).

ALTER TABLE "ProductoAdmiteGrupo" ADD COLUMN "seMuestraEnCarta" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE ("seMuestraEnCarta") ON "ProductoAdmiteGrupo" TO motor2_app;
  END IF;
END
$$;
