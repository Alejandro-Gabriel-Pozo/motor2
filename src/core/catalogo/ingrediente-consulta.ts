/**
 * Lo que puede ser INGREDIENTE de una receta y lo que puede CONSUMIR una opción de venta, como `where` de Prisma (E4-3b de la Reventa, docs/diseno-reventa-e4-2026-11-17.md §7, regla R7): los espejos EN CONSULTA de
 * `capacidadesDelProducto(...).esIngredienteDeReceta` y `.loConsumeUnaOpcion` (como `whereSeCompra`). PUROS (objetos planos, sin base). Hoy son la misma lista de PERMITIDOS: una MP, o una REVENTA coherente (PV, clase
 * REVENTA, que no se produce); lo que no está acá no entra (todo nace cerrado). Dos funciones y no una porque son dos capacidades que pueden separarse. Los compara contra la función, sobre Postgres real,
 * `test/catalogo/ingrediente-equivalencia.test.ts`.
 */
const MP_O_REVENTA = () => ({ OR: [{ tipo: "MP" as const }, { tipo: "PV" as const, claseDeUso: "REVENTA", seProduce: false }] });

export function whereEsIngredienteDeReceta() {
  return MP_O_REVENTA();
}

export function whereLoConsumeUnaOpcion() {
  return MP_O_REVENTA();
}
