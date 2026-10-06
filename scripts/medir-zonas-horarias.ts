/**
 * Zona horaria de cada empresa (solo lectura, no modifica nada), en la base que apunte DATABASE_URL: slug, zona y si es una zona IANA que `Intl`
 * conoce. Marca las que NO son la de Argentina (`ZONA_ARGENTINA`): hoy todo el código supone esa zona donde no recibe la de la empresa
 * (`validarFechaOperacion`, cotización del dólar), así que una empresa con otro valor se vería distinta según la pantalla.
 *
 * Uso: npm run medir-zonas
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ZONA_ARGENTINA, esZonaHorariaValida } from "../src/core/tiempo/zona-horaria";

async function main() {
  const empresas = await prisma.empresa.findMany({ select: { slug: true, estado: true, zonaHoraria: true }, orderBy: { slug: "asc" } });
  let aRevisar = 0;
  for (const e of empresas) {
    const valida = esZonaHorariaValida(e.zonaHoraria);
    const marca = !valida ? "INVÁLIDA" : e.zonaHoraria === ZONA_ARGENTINA ? "ok (Argentina)" : "DISTINTA DE ARGENTINA";
    if (!valida || e.zonaHoraria !== ZONA_ARGENTINA) aRevisar++;
    console.log(`${e.slug} [${e.estado}]: «${e.zonaHoraria}» → ${marca}`);
  }
  console.log(`Empresas: ${empresas.length}; a revisar antes de seguir: ${aRevisar}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
