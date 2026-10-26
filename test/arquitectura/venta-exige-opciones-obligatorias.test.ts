import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (fila O.430 de `docs/pureza-integracion.md`; molde de `lectores-de-receta.test.ts` y de `lectores-de-version-de-opcion.test.ts`): UN PRODUCTO CON OPCIONES
 * OBLIGATORIAS NO SE VENDE SIN ELEGIRLAS, en TODA vía que vende. La regla de oro del proyecto es que la validación vive en el servidor y en todas las vías: el hueco que cierra esto era que la venta
 * de mostrador (que no tiene selector de opciones) cobraba un producto con un grupo obligatorio al precio base. La barrera está en el NÚCLEO de la venta (`armarLinea`, en
 * `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`), así que una vía futura de venta queda cubierta si pasa por ahí; este test impide que la haya por otro lado:
 *
 *  1. SOLO ese archivo arma una línea de venta (`armarLinea`) y escribe la Operacion de una venta (`escribirOperacionDeVenta`): una vía que escribiera ventas por su cuenta no pasaría por la barrera.
 *  2. Quien llama al núcleo (`registrarVentaEnTx`) está en una lista cerrada, con motivo (verificada en las dos direcciones). Una vía nueva se declara acá a propósito.
 *  3. La venta de mostrador mapea cada línea A MANO a `{ productoId, cantidadVendida }`: nunca manda `configurada` (lo único que saltea la barrera: una línea configurada ya trae lo elegido) ni un precio.
 *  4. La barrera existe y está bien puesta en el núcleo: en `armarLinea`, para toda línea SIN configurar (`configurada === undefined`), con el código estable, ANTES de escribir nada; los grupos se leen UNA vez
 *     por lote (no por línea) con el lector de las opciones de venta que usa el POS, dentro del núcleo (la transacción de quien llama), antes del bucle de las líneas.
 *  5. La regla no se reimplementa: la pura (`core/movimientos/opciones-obligatorias.ts`) llama a `validarOpcionesElegidas` con CERO opciones, la misma validación que aplica el POS al agregar.
 *
 * Los comentarios se descartan sobre el archivo entero (un comentario que nombre la llamada no cuenta) y los patrones se buscan a través de saltos de línea.
 */
const SRC = join(__dirname, "../../src");
const NUCLEO = "server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts";
const REGLA_PURA = "core/movimientos/opciones-obligatorias.ts";

/** Quién llama a `registrarVentaEnTx` (aparte del núcleo): una lista CERRADA. Una vía nueva se suma acá, con motivo, y queda cubierta por la barrera del núcleo. */
const VIAS_DE_VENTA: readonly { ruta: string; motivo: string }[] = [
  {
    ruta: "server/actions/movimientos/casos-de-uso/registrar-venta.ts",
    motivo: "La venta de MOSTRADOR: sin selector de opciones, mapea cada línea a mano a `{ productoId, cantidadVendida }` (jamás `configurada`), así que todo producto con un grupo obligatorio se rechaza en el núcleo.",
  },
  {
    ruta: "server/actions/pos/casos-de-uso/cerrar-cuenta.ts",
    motivo: "El cierre de la cuenta del salón: sus líneas con opciones traen `configurada` (la foto congelada al pedir, ya validada al agregar); una línea sin foto de un producto con un grupo obligatorio se rechaza en el núcleo.",
  },
];

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** El archivo sin comentarios (`//` y `/* *\/`), conservando los saltos de línea y lo que está dentro de un string o una plantilla. */
function sinComentarios(fuente: string): string {
  const s = fuente.replace(/\r\n/g, "\n");
  let salida = "";
  let modo: '"' | "'" | "`" | null = null;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const siguiente = s[i + 1];
    if (modo) {
      salida += c;
      if (c === "\\") {
        salida += siguiente ?? "";
        i += 2;
        continue;
      }
      if (c === modo || (c === "\n" && modo !== "`")) modo = null;
      i++;
      continue;
    }
    if (c === "/" && siguiente === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && siguiente === "*") {
      const fin = s.indexOf("*/", i + 2);
      const bloque = fin === -1 ? s.slice(i) : s.slice(i, fin + 2);
      salida += bloque.replace(/[^\n]/g, " ");
      i += bloque.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") modo = c;
    salida += c;
    i++;
  }
  return salida;
}

/** El cuerpo de `async function <nombre>(…) {…}` de primer nivel: del encabezado hasta la `}` que cierra en la columna 0. */
function cuerpoDe(codigo: string, nombre: string): string {
  const inicio = codigo.search(new RegExp(`(^|\\n)(export )?async function ${nombre}\\(`));
  if (inicio === -1) return "";
  const fin = codigo.indexOf("\n}\n", inicio);
  return codigo.slice(inicio, fin === -1 ? undefined : fin + 2);
}

/** El cuerpo de `function <nombre>(…) {…}` (sin `async`) de primer nivel. */
function cuerpoDeSincrona(codigo: string, nombre: string): string {
  const inicio = codigo.search(new RegExp(`(^|\\n)(export )?function ${nombre}\\(`));
  if (inicio === -1) return "";
  const fin = codigo.indexOf("\n}\n", inicio);
  return codigo.slice(inicio, fin === -1 ? undefined : fin + 2);
}

const fuentes = new Map(archivosFuente(SRC).map((ruta) => [relative(SRC, ruta).split(sep).join("/"), sinComentarios(readFileSync(ruta, "utf8"))]));
/** Los archivos que LLAMAN a `nombre(…)` (la declaración `function nombre(` no es una llamada). */
const llamadas = (nombre: string) => [...fuentes].filter(([, codigo]) => new RegExp(`(?<!function )\\b${nombre}\\s*\\(`).test(codigo)).map(([ruta]) => ruta);

describe("la venta exige las opciones obligatorias en toda vía", () => {
  it("encuentra archivos de src/ y el núcleo de la venta", () => {
    expect(fuentes.size).toBeGreaterThan(50);
    expect(fuentes.has(NUCLEO)).toBe(true);
    expect(fuentes.has(REGLA_PURA)).toBe(true);
  });

  it("(1) solo el núcleo arma una línea de venta y escribe la Operacion de una venta: ninguna vía vende por su cuenta", () => {
    expect(llamadas("armarLinea")).toEqual([NUCLEO]);
    expect(llamadas("escribirOperacionDeVenta")).toEqual([NUCLEO]);
  });

  it("(2) las vías que llaman al núcleo son exactamente las declaradas, con motivo (en las dos direcciones)", () => {
    const quienes = llamadas("registrarVentaEnTx").sort();
    expect(quienes, "una vía nueva que venda con el núcleo se declara en VIAS_DE_VENTA: queda cubierta por su barrera").toEqual(VIAS_DE_VENTA.map((v) => v.ruta).sort());
    for (const v of VIAS_DE_VENTA) expect(v.motivo.length, v.ruta).toBeGreaterThan(40);
  });

  it("(3) la venta de mostrador no manda `configurada` (lo único que saltea la barrera) ni un precio: cada línea va a mano como `{ productoId, cantidadVendida }`", () => {
    const mostrador = fuentes.get("server/actions/movimientos/casos-de-uso/registrar-venta.ts")!;
    expect(mostrador).not.toMatch(/\bconfigurada\b/);
    expect(mostrador).not.toMatch(/\bprecioUnitario\b/);
    expect(mostrador).toMatch(/lineas:\s*datos\.ventas\.map\(\(item\) => \(\{ productoId: item\.productoId, cantidadVendida: item\.cantidadVendida \}\)\)/);
  });

  it("(4) la barrera está en `armarLinea`, para toda línea SIN configurar, con el código estable y antes de leer la receta y de escribir nada", () => {
    const nucleo = fuentes.get(NUCLEO)!;
    const armarLinea = cuerpoDe(nucleo, "armarLinea");
    expect(armarLinea, "no se encontró el cuerpo de armarLinea").not.toBe("");
    const barrera = armarLinea.search(/if \(configurada === undefined\) \{[^}]*rechazoPorOpcionesObligatorias\(/);
    expect(barrera, "armarLinea tiene que rechazar una línea sin configurar con `rechazoPorOpcionesObligatorias`").toBeGreaterThan(-1);
    expect(armarLinea).toMatch(/codigo: CODIGO_PRODUCTO_REQUIERE_OPCIONES/);
    // Antes de la receta (la lectura siguiente) y, en el archivo, antes de la primera escritura.
    expect(barrera).toBeLessThan(armarLinea.indexOf("cargarRecetaVigenteParaVender("));
    expect(nucleo.indexOf("rechazoPorOpcionesObligatorias(")).toBeLessThan(nucleo.indexOf("escribirOperacionDeVenta(tx"));
  });

  it("(4) los grupos se leen UNA vez por lote con el lector del POS: en un lector memoizado (no en `armarLinea`, ni dentro del bucle), creado con el `tx` del núcleo antes del bucle de las líneas", () => {
    const nucleo = fuentes.get(NUCLEO)!;
    const lecturas = [...nucleo.matchAll(/\bcargarOpcionesParaVender\s*\(/g)];
    expect(lecturas, "una sola llamada al lector de las opciones de venta en todo el núcleo").toHaveLength(1);
    // La llamada está dentro del lector memoizado (`??=`: la primera vez lee, después reusa), con el tx de quien llama y no con el cliente global.
    const lector = cuerpoDeSincrona(nucleo, "crearLectorDeGruposAdmitidos");
    expect(lector).toMatch(/leidos \?\?= cargarOpcionesParaVender\(tx,/);
    expect(cuerpoDe(nucleo, "armarLinea")).not.toMatch(/cargarOpcionesParaVender/);
    expect(cuerpoDe(nucleo, "registrarVentaEnTx")).not.toMatch(/cargarOpcionesParaVender/);
    // El lector se crea ANTES del bucle de las líneas, y `armarLinea` lo recibe y lo usa en la barrera.
    const creacion = nucleo.indexOf("crearLectorDeGruposAdmitidos(tx, actor.sucursalId, datos.lineas)");
    const bucle = nucleo.indexOf("for (const [i, item] of datos.lineas.entries())");
    expect(creacion).toBeGreaterThan(-1);
    expect(creacion).toBeLessThan(bucle);
    expect(nucleo).toMatch(/armarLinea\(item, [^)]*gruposAdmitidosDe\)/);
    // Fase 4 (ADR-035): el lector devuelve también si el producto se vende por opción (`esBase`): una base no se cobra suelta.
    expect(cuerpoDe(nucleo, "armarLinea")).toMatch(/const admite = await gruposAdmitidosDe\(producto\.id\);\s*const sinOpciones = rechazoPorOpcionesObligatorias\(producto\.nombre, admite\.grupos, admite\.esBase\)/);
  });

  it("(5) la regla pura no se reimplementa: llama a `validarOpcionesElegidas` con cero opciones, la misma validación del POS", () => {
    const regla = fuentes.get(REGLA_PURA)!;
    expect(regla).toMatch(/validarOpcionesElegidas\(\s*grupos,\s*\[\]\s*\)/);
    expect(regla).toMatch(/PRODUCTO_REQUIERE_OPCIONES/);
  });
});
