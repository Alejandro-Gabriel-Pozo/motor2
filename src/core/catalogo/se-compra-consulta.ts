/**
 * Lo que se puede COMPRAR, como `where` de Prisma (E4-2 de la Reventa, docs/diseno-reventa-e4-2026-11-17.md §7): el espejo EN CONSULTA de `capacidadesDelProducto(...).seCompra` (un predicado sobre un producto ya cargado no se puede
 * compartir literalmente con un `where`). PURO (objetos planos, sin base). Una MP, o una REVENTA coherente (PV, clase REVENTA, que no se produce). Lo que no está en la lista no se compra (todo nace cerrado).
 * La prueba `test/catalogo/se-compra-equivalencia.test.ts` compara este `where`, sobre la base real, con la función para cada combinación.
 */
export function whereSeCompra() {
  return { OR: [{ tipo: "MP" as const }, { tipo: "PV" as const, claseDeUso: "REVENTA", seProduce: false }] };
}
