import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Carta «B», E3 (2026-11-04), invariante I4: la descripción de una opción (`OpcionDeGrupo.descripcionEnCarta`) la lee SOLO la carta (pública, impresa, vista previa del producto y «Va a mostrar»). NUNCA el ticket, la
 * comanda, el POS, el stock ni los reportes, y la foto de una venta (`OpcionElegidaEnLinea`) no la copia. El guardián compara, en las dos direcciones, los archivos de `src/` que nombran la columna con la lista
 * cerrada de abajo (cada uno con su motivo): un lector nuevo (por ejemplo el ticket) aparece como archivo de más y falla hasta que alguien lo declare a propósito. Además la foto de venta no tiene la columna.
 */
const RAIZ = join(__dirname, "../..");

const LISTA_CERRADA: Record<string, string> = {
  "src/app/(app)/catalogo/opciones/[grupoId]/alta-de-opcion.tsx": "administración: el campo del alta de la opción",
  "src/app/(app)/catalogo/opciones/[grupoId]/page.tsx": "administración: el formulario de la descripción junto a «Renombrar»",
  "src/core/carta/presentacion-en-carta.ts": "CARTA: la descripción de cada opción de una elección sin costo",
  "src/core/features/catalogo/opciones-de-venta.guard.ts": "administración: validación del comando",
  "src/core/features/catalogo/opciones-de-venta.schema.ts": "administración: tipos del comando",
  "src/core/pos/linea-configurada.ts": "tipo de la opción con el campo OPCIONAL y solo de la carta (la venta no lo carga)",
  "src/core/pos/precio-de-configuracion.ts": "tabla de precios PARA LA CARTA (`tablaDePreciosParaLaCarta`): la pasa a la forma de la carta; no entra a ningún precio",
  "src/server/actions/catalogo/casos-de-uso/crear-opcion-de-grupo.ts": "administración: el alta (con auditoría)",
  "src/server/actions/catalogo/casos-de-uso/editar-opcion-de-grupo.ts": "administración: la edición (con auditoría por columna)",
  "src/server/actions/catalogo/casos-de-uso/opciones-de-venta-en-tx.ts": "administración: lectura dentro de la transacción de edición",
  "src/server/actions/catalogo/opciones-de-venta.ts": "administración: la acción",
  "src/server/consultas/catalogo/opciones-de-venta.ts": "administración: el panel del grupo",
  "src/server/lecturas/carta/opciones.ts": "CARTA: el único lector de la carta (lista cerrada `PUBLICACION_CARTA`)",
  "src/server/lecturas/catalogo/opciones-de-venta.ts": "administración: lectura del catálogo de opciones",
  "src/server/persistencia/catalogo/opciones-de-venta.ts": "administración: escritura",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("la descripción de la opción es solo de la carta", () => {
  const conLaColumna = archivos(join(RAIZ, "src"))
    .filter((f) => readFileSync(f, "utf8").includes("descripcionEnCarta"))
    .map((f) => relative(RAIZ, f).split("\\").join("/"))
    .sort();

  it("los archivos de src/ que nombran la columna son EXACTAMENTE los de la lista cerrada (ni ticket, ni comanda, ni POS, ni stock, ni reportes)", () => {
    expect(conLaColumna).toEqual(Object.keys(LISTA_CERRADA).sort());
  });

  it("ninguna lectura de venta, ticket, comanda, stock o reportes la nombra", () => {
    const prohibidos = conLaColumna.filter((f) => /\/(pos|ticket|comanda|stock|movimientos|reportes|ventas)\//.test(f) && f !== "src/core/pos/linea-configurada.ts" && f !== "src/core/pos/precio-de-configuracion.ts");
    expect(prohibidos).toEqual([]);
  });

  it("la foto de la venta (`OpcionElegidaEnLinea`) no tiene la columna: no la copia", () => {
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
    const modelo = schema.match(/model OpcionElegidaEnLinea \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(modelo).toContain("model OpcionElegidaEnLinea");
    expect(modelo).not.toMatch(/descripcion/i);
  });
});
