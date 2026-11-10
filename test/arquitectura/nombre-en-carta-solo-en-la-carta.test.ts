import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Nombre en la carta» (2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`): `ContenidoCartaProducto.nombreEnCarta` lo leen SOLO la carta (pública, impresa, vista previa del producto) y el selector del
 * mozo. NUNCA la comanda, el ticket, la cocina, el stock ni los reportes: ahí el producto sigue con su nombre interno, y la foto de una venta no lo copia. El guardián compara, en las dos direcciones, los
 * archivos de `src/` que nombran la columna con la lista cerrada de abajo (cada uno con su motivo): un lector nuevo (por ejemplo el ticket) aparece como archivo de más y falla hasta que alguien lo declare.
 */
const RAIZ = join(__dirname, "../..");

const LISTA_CERRADA: Record<string, string> = {
  "src/app/(app)/catalogo/productos/[id]/opciones/page.tsx": "administración: el nombre de la vista previa del producto",
  "src/app/(pos)/mesas/[mesaId]/selector-carta.tsx": "SELECTOR DEL MOZO: muestra el nombre de la carta en los botones de producto directo",
  "src/components/carta/contenido-del-producto.tsx": "administración: el campo del formulario y el dato de solo lectura",
  "src/core/carta/admin-tipos.ts": "administración: tipo del contenido",
  "src/core/carta/incluye-en-carta.ts": "CARTA: «Va con» nombra a una base oculta por los rótulos de sus renglones (no por su nombre interno ni por el de la carta)",
  "src/core/carta/nombre-para-mostrar.ts": "ADMINISTRACIÓN DE PROMOS (pedido del dueño, 2026-11-05): el nombre para mostrar de una base con el nombre oculto; resuelve con `nombreDeCarta` (la única regla) y lo lee solo quien arma, nunca la venta",
  "src/core/carta/nombre-en-carta.ts": "CARTA: el estado del nombre (pendiente / propio / confirmado) y el control de nombres repetidos",
  "src/core/carta/armar-menu.ts": "CARTA: `nombreDeCarta`, la única regla de resolución, y el nombre de cada plato",
  "src/core/features/carta/contenido-producto.guard.ts": "administración: validación del comando",
  "src/core/features/carta/contenido-producto.schema.ts": "administración: tipos del comando",
  "src/core/pos/selector-carta.ts": "SELECTOR DEL MOZO: el campo OPCIONAL del pedible; la venta no lo copia",
  "src/server/actions/carta/casos-de-uso/actualizar-visible-en-carta.ts": "administración: mostrar un plato comprueba su nombre efectivo contra la carta (sin nombres repetidos)",
  "src/server/actions/carta/casos-de-uso/confirmar-nombre-en-carta.ts": "administración: «Está bien así» (con auditoría por columna)",
  "src/server/actions/carta/casos-de-uso/copiar-carta-de-sucursal.ts": "administración: la copia de carta lo lleva",
  "src/server/actions/carta/casos-de-uso/reemplazar-carta-de-sucursal.ts": "administración: reemplazar la carta con la de otra sucursal lo lleva igual que la copia (y lo guarda en la foto de auditoría de lo eliminado)",
  "src/core/features/carta/reemplazar-carta.ts": "administración: la firma, la proyección de la copia y la foto de auditoría de «reemplazar la carta» lo llevan como el resto de las columnas copiables",
  "src/server/actions/carta/casos-de-uso/guardar-contenido-carta-producto.ts": "administración: el único que lo escribe (con auditoría por columna)",
  "src/server/actions/carta/casos-de-uso/quitar-producto-de-la-carta.ts": "administración: audita lo que se pierde al quitar",
  "src/server/actions/carta/contenido-producto.ts": "administración: la acción",
  "src/server/consultas/carta/combos.ts": "ADMINISTRACIÓN DE PROMOS (PR B): lee el nombre de la carta de la sucursal para el nombre para mostrar al armar un lugar; no es venta, ticket ni comanda",
  "src/server/consultas/carta/admin.ts": "administración: lectura del contenido y de la vista previa",
  "src/server/lecturas/catalogo/busqueda-de-producto.ts": "BUSCADOR DEL MOZO (POS): encuentra también por el nombre de carta de la sucursal activa (el resultado sigue mostrando código y nombre interno)",
  "src/server/lecturas/carta/choque-de-nombre.ts": "administración: junta los nombres usados en la carta de la sucursal para detectar un nombre repetido",
  "src/server/lecturas/carta/nombres-para-el-ticket.ts": "VENTA (2026-11-05, decisión del dueño): lo lee UNA vez al agregar al pedido para CONGELARLO en la línea (`CuentaItem.nombreEnTicket`); el ticket del cliente lee la copia congelada, nunca esta columna",
  "src/server/lecturas/carta/menu.ts": "CARTA: el lector de la carta (lista cerrada `PUBLICACION_CARTA`)",
  "src/server/lecturas/pos/selector-carta.ts": "SELECTOR DEL MOZO: lee el nombre de la carta de la sucursal",
  "src/server/persistencia/carta/contenido-producto.ts": "administración: escritura",
  "src/server/persistencia/carta/copiar-carta.ts": "administración: la copia de carta lo lleva",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("el nombre en la carta es solo de la carta y del selector del mozo", () => {
  const conLaColumna = archivos(join(RAIZ, "src"))
    .filter((f) => readFileSync(f, "utf8").includes("nombreEnCarta"))
    .map((f) => relative(RAIZ, f).split("\\").join("/"))
    .sort();

  it("los archivos de src/ que nombran la columna son EXACTAMENTE los de la lista cerrada (ni ticket, ni comanda, ni cocina, ni stock, ni reportes)", () => {
    expect(conLaColumna).toEqual(Object.keys(LISTA_CERRADA).sort());
  });

  it("ninguna lectura de venta, ticket, comanda, cocina, stock o reportes la nombra (salvo el pedible del selector)", () => {
    const prohibidos = conLaColumna.filter((f) => /\/(ticket|comanda|cocina|stock|movimientos|reportes|ventas)\//.test(f));
    expect(prohibidos).toEqual([]);
  });

  it("las líneas de la venta no tienen la columna: no la copian", () => {
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
    for (const modelo of ["ItemCuenta", "CuentaItem", "OpcionElegidaEnLinea"]) {
      const cuerpo = schema.match(new RegExp(`model ${modelo} \\{[\\s\\S]*?\\n\\}`))?.[0];
      if (cuerpo) expect(cuerpo, modelo).not.toContain("nombreEnCarta");
    }
  });
});
