import type { PrismaClient } from "@prisma/client";

/**
 * Aviso de «instalación atrasada en migraciones» (ADR-025): la consola es un solo código desplegado sobre varias bases que se migran de a una, así que
 * durante la ventana normal de un deploy una puede tener aplicada una migración que la otra todavía no tiene. Esto lee `_prisma_migrations` —el
 * registro OFICIAL de Prisma, sin inventar una comparación de esquema propia— con el rol de la consola, que necesita un `GRANT SELECT` adicional
 * (`scripts/operaciones/crear-rol-motor2-plataforma.sql`): mientras ese grant no esté, o la tabla no exista todavía en una base muy vieja, esta función
 * no lanza, devuelve `null` y el aviso simplemente no aparece (es informativo, nunca puede tumbar el inicio).
 */
const SIN_TABLA_O_SIN_PERMISO = /\b(42P01|42501)\b/;

export async function migracionesAplicadas(db: PrismaClient): Promise<string[] | null> {
  try {
    const filas = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
    `;
    return filas.map((f) => f.migration_name);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    if (SIN_TABLA_O_SIN_PERMISO.test(mensaje)) return null;
    throw error;
  }
}
