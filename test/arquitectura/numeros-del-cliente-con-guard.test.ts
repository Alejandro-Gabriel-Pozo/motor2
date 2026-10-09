import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { entradasDeLasAcciones, indiceDeMiembros, type IndiceDeMiembros } from "./guardas/parametros-de-acciones";

/**
 * GT-11 (tanda T14 del plan de endurecimiento de seguridad; fila O.96 de `docs/pureza-integracion.md`): **TODO NÚMERO Y TODO ARREGLO QUE EL CLIENTE MANDA A UNA SERVER ACTION PASA POR UN GUARD DE
 * COMANDO CON RANGO, o está en una lista de pendientes con su motivo**. Una Server Action es una puerta HTTP: lo que llega puede ser cualquier cosa (un `NaN`, un número enorme, una lista de
 * diez mil elementos). S-01 fue eso: las elecciones de una promo del POS aceptaban secciones repetidas, productos fuera de los cupos y cantidades sin rango. El guard de comando
 * (`core/features/**\/*.guard.ts`, `guardComando…`) es el único lugar donde se decide el formato y el rango ANTES de abrir una transacción.
 *
 * Qué fija, por AST y sin base (la herramienta es `guardas/parametros-de-acciones.ts`: resuelve el tipo de cada parámetro —en línea, de la misma fuente o de cualquier archivo de `src/`— y
 * junta las rutas numéricas y de arreglo):
 *  1. **Inventario.** Toda Server Action exportada con un parámetro numérico o de arreglo o llama a un `guardComando…` (se detecta sola) o figura en `SIN_GUARD_DE_COMANDO` con su motivo. Una acción
 *     nueva con números que no hace ninguna de las dos falla; una declarada que ahora SÍ llama al guard sale de la lista (la lista SOLO se achica).
 *  2. **Lista inicial de reglas de rango** (`REGLAS`): cada una con el archivo que la lleva y las líneas que la sostienen. Arranca con las ELECCIONES DE LA PROMO (S-01): forma, sección que es un
 *     cupo, sección y producto repetidos, cantidad entera y positiva, producto elegible, mínimo y máximo del cupo, y el tope de ítems por agregado del guard. Quitar una → rojo.
 *  3. **Pendientes declarados (S-52)**: las acciones sin guard de comando de arriba. Son entradas numéricas y de id que hoy se validan dentro del caso de uso (o en la propia acción) y no en un guard;
 *     dentro de la empresa, el peor efecto es un 500 o un redondeo. Destino: rama «endurecimiento 2» (ver el plan, S-52 y GT-11).
 *
 * Mutaciones (cada una pone un caso en rojo): una acción nueva con un `number` y sin guard; sacar la llamada a `guardComandoAgregarItems` de `agregarItems`; sacar el tope de ítems del guard; sacar la
 * comprobación de la sección repetida de `validarYAplanarEleccionPromo`; una entrada de más en `SIN_GUARD_DE_COMANDO`.
 */
const RAIZ = join(__dirname, "../..");

const PENDIENTE = (que: string) => `${que} Se valida dentro del caso de uso o de la acción y no en un guard de comando con rango: pendiente S-52 (entradas numéricas y de id sin rango), rama «endurecimiento 2».`;

/** `archivo desde src/server/actions|función` → por qué no pasa por un `guardComando…`. Lista cerrada: solo se achica. */
const SIN_GUARD_DE_COMANDO: Readonly<Record<string, string>> = {
  "carta/contenido-producto.ts|guardarContenidoCartaProducto": PENDIENTE("Orden y etiquetas del contenido de un producto de la carta: lo valida `guardar-contenido-carta-producto.ts`."),
  "carta/items-agrupados.ts|agregarOpcionItemAgrupadoCarta": PENDIENTE("El orden de una opción de un ítem agrupado: lo valida `agregar-opcion-item-agrupado-carta.ts`."),
  "carta/promos.ts|guardarPrecioLocalPromoCarta": PENDIENTE("El precio de una promo en la sucursal: la acción lee la promo ANTES de validar el precio (una promo inexistente gana sobre un precio inválido: ver SIN_GUARD de `acciones-migradas-con-guard`)."),
  "carta/promos.ts|guardarCuposPromoCarta": PENDIENTE("Los cupos de una promo (mínimo y máximo por sección): los valida `guardar-cupos-promo-carta.ts` dentro de la transacción (S-06)."),
  "catalogo/productos.ts|darDeAltaProducto": PENDIENTE("Precio, factor, paso y consignación de un producto nuevo: `validarDatosDeProducto` (server/lecturas) los valida dentro de la transacción."),
  "catalogo/productos.ts|actualizarProducto": PENDIENTE("Precio, factor, paso y consignación de un producto: `validarDatosDeProducto` los valida dentro de la transacción (S-05)."),
  "catalogo/productos.ts|agregarPresentacionAlternativa": PENDIENTE("El factor de una presentación alternativa: lo valida `agregar-presentacion-alternativa.ts`."),
  "catalogo/receta-sucursal.ts|crearRecetaPropiaDesdeLaCentral": PENDIENTE("La versión que vio la pantalla (`versionVista`) de una receta propia."),
  "catalogo/receta-sucursal.ts|agregarIngredienteARecetaPropia": PENDIENTE("Cantidad, merma y sustitutos de un ingrediente de la receta propia: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
  "catalogo/receta-sucursal.ts|actualizarIngredienteDeRecetaPropia": PENDIENTE("Cantidad y merma de un ingrediente de la receta propia: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
  "catalogo/receta-sucursal.ts|quitarIngredienteDeRecetaPropia": PENDIENTE("La versión que vio la pantalla (`versionVista`) de una receta propia."),
  "catalogo/receta-sucursal.ts|copiarRecetaPropiaDeOtraSucursal": PENDIENTE("La versión que vio la pantalla (`versionVista`) de la receta de origen."),
  "catalogo/recetas.ts|agregarIngredienteAReceta": PENDIENTE("Cantidad, merma y sustitutos de un ingrediente: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
  "catalogo/recetas.ts|actualizarIngredienteDeReceta": PENDIENTE("Cantidad, merma y sustitutos de un ingrediente: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
  "catalogo/recetas.ts|quitarIngredienteDeReceta": PENDIENTE("La versión que vio la pantalla (`versionVista`)."),
  "catalogo/recetas.ts|agregarPasoAReceta": PENDIENTE("Orden, minutos e insumos de un paso: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
  "catalogo/recetas.ts|actualizarPasoDeReceta": PENDIENTE("Orden, minutos e insumos de un paso: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
  "catalogo/recetas.ts|quitarPasoDeReceta": PENDIENTE("El orden del paso y la versión que vio la pantalla."),
  "catalogo/recetas.ts|reordenarPasosDeReceta": PENDIENTE("La secuencia nueva de los pasos (un arreglo de números) y la versión que vio la pantalla: la valida `guardarVersionDeReceta`."),
  "catalogo/recetas.ts|insertarPasoEnReceta": PENDIENTE("La posición del paso nuevo y la versión que vio la pantalla."),
  "catalogo/recetas.ts|actualizarCabeceraDeReceta": PENDIENTE("Rendimiento, raciones, tamaño y tiempos de la cabecera: `core/catalogo/receta-validacion` dentro de `guardarVersionDeReceta`."),
};

/**
 * Reglas de rango fijadas con evidencia en el código: `archivo` (desde la raíz) debe contener TODAS las `lineas` (expresiones regulares sobre el texto con saltos LF). Lista inicial: las
 * elecciones de la promo (S-01). Una regla nueva se agrega con su evidencia; una que ya no se cumple pone el test en rojo.
 */
const REGLAS: readonly { nombre: string; archivo: string; lineas: readonly RegExp[] }[] = [
  {
    nombre: "Elecciones de la promo del POS: forma, secciones, productos y cantidades (S-01)",
    archivo: "src/core/pos/promo-combo.ts",
    lineas: [
      /if \(!Array\.isArray\(elecciones\)\) return formaRota;/,
      /typeof seccionCartaId !== "string" \|\| !Array\.isArray\(elegidos\)/,
      /if \(!seccionesDeCupo\.has\(seccionCartaId\)\) return/,
      /if \(eleccionPorSeccion\.has\(seccionCartaId\)\) return/,
      /if \(!Number\.isInteger\(el\.cantidad\) \|\| el\.cantidad <= 0\)/,
      /if \(!cupo\.elegibles\.has\(el\.productoId\)\)/,
      /if \(productosYaElegidos\.has\(el\.productoId\)\)/,
      /if \(total < cupo\.cantidadMinima\)/,
      /if \(total > cupo\.cantidadMaximaCupo\)/,
    ],
  },
  {
    nombre: "Ítems por agregado al pedido del POS: tope de líneas, contando los componentes de cada promo (S-01)",
    archivo: "src/core/features/cuentas/cuenta-pedido.guard.ts",
    lineas: [/if \(cantidadDeLineas > MAXIMO_ITEMS_POR_AGREGADO\) return rechazar\("rango"/, /componentesDeEleccion\(Array\.isArray\(p\?\.elecciones\) \? p\.elecciones : \[\]\)/],
  },
  {
    nombre: "Ítems por envío a cocina: tope (el arreglo `itemIds`)",
    archivo: "src/core/features/cuentas/cuenta-pedido.guard.ts",
    lineas: [/if \(itemIds\.length > MAXIMO_ITEMS_POR_ENVIO\) return rechazar\("rango"/],
  },
  {
    nombre: "Cambios de la matriz de permisos por guardado: tope (el arreglo `cambios`)",
    archivo: "src/core/features/permisos/matriz.guard.ts",
    lineas: [/if \(cambios\.length > MAXIMO_CAMBIOS\) return rechazar\("rango"/],
  },
];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

const leerLF = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8").replace(/\r\n/g, "\n");
const todos = archivos(join(RAIZ, "src"));
const INDICE: IndiceDeMiembros = indiceDeMiembros(todos.map((f) => readFileSync(f, "utf8")));
const ACCIONES_ZONA = "src/server/actions/";

const delCodigo = todos
  .filter((f) => {
    const r = relative(RAIZ, f).split(sep).join("/");
    return r.startsWith(ACCIONES_ZONA) && !r.includes("/casos-de-uso/");
  })
  .flatMap((f) => entradasDeLasAcciones(relative(join(RAIZ, ACCIONES_ZONA), f).split(sep).join("/"), readFileSync(f, "utf8"), INDICE));

const llamaAUnGuard = (llamadas: ReadonlySet<string>) => [...llamadas].some((l) => /^guardComando[A-Z]/.test(l));

describe("GT-11 — números y arreglos del cliente: un guard de comando con rango, o un pendiente declarado", () => {
  it("el detector resuelve tipos en línea, nombrados, anidados y arreglos (casos sintéticos)", () => {
    const indice = indiceDeMiembros(["export interface Linea { cantidad: number; nota?: string }", "export type Datos = { lineas: Linea[]; total: number } & { extra: ReadonlyArray<{ n: number }> }"]);
    const e = entradasDeLasAcciones("x.ts", '"use server";\nexport async function pedir(d: Datos, limite: number, ids: string[]) { return guardComandoPedir(d); }', indice);
    expect(e).toHaveLength(1);
    expect(e[0]!.clave).toBe("x.ts|pedir");
    expect([...e[0]!.numericos].sort()).toEqual(["d.extra[].n", "d.lineas[].cantidad", "d.total", "limite"]);
    expect([...e[0]!.arreglos].sort()).toEqual(["d.extra[]", "d.lineas[]", "ids[]"]);
    expect(llamaAUnGuard(e[0]!.llamadas)).toBe(true);
    // sin números ni arreglos no es una entrada; un archivo sin "use server" tampoco
    expect(entradasDeLasAcciones("x.ts", '"use server";\nexport async function a(id: string, ok: boolean) {}', indice)).toEqual([]);
    expect(entradasDeLasAcciones("x.ts", "export async function a(n: number) {}", indice)).toEqual([]);
    // un tipo que se llama a sí mismo no cuelga el recorrido
    const ciclo = indiceDeMiembros(["export interface Nodo { valor: number; hijos: Nodo[] }"]);
    const delCiclo = entradasDeLasAcciones("x.ts", '"use server";\nexport async function a(n: Nodo) {}', ciclo)[0]!;
    expect(delCiclo.numericos).toEqual(["n.valor"]);
    expect(delCiclo.arreglos).toEqual(["n.hijos[]"]);
  });

  it("sanidad: el recorrido ve las acciones con números (no pasa en vacío)", () => {
    expect(delCodigo.length).toBeGreaterThan(40);
    expect(delCodigo.some((e) => e.clave === "pos/cuenta-pedido.ts|agregarItems" && e.numericos.includes("promos[].elecciones[].elegidos[].cantidad"))).toBe(true);
  });

  it("toda acción con números o arreglos llama a un guardComando…, o está en SIN_GUARD_DE_COMANDO (y la lista no tiene sobrantes)", () => {
    const sinGuard = delCodigo.filter((e) => !llamaAUnGuard(e.llamadas)).map((e) => e.clave).sort();
    expect(sinGuard, "una acción con números sin guard de comando se agrega a SIN_GUARD_DE_COMANDO con su motivo (o, mejor, se le escribe su guard); una que ya lo llama sale de la lista").toEqual(
      Object.keys(SIN_GUARD_DE_COMANDO).sort(),
    );
    for (const [k, motivo] of Object.entries(SIN_GUARD_DE_COMANDO)) expect(motivo.length, k).toBeGreaterThan(60);
  });

  it("la lista de pendientes solo se achica (21 hoy)", () => {
    expect(Object.keys(SIN_GUARD_DE_COMANDO).length).toBeLessThanOrEqual(21);
  });

  it.each(REGLAS)("regla de rango: $nombre", ({ archivo, lineas }) => {
    const texto = leerLF(archivo);
    for (const l of lineas) expect(texto, `${archivo}: falta ${l}`).toMatch(l);
  });

  it("agregarItems y enviarACocina llaman a su guard de comando (las dos puertas del pedido del POS)", () => {
    const porClave = new Map(delCodigo.map((e) => [e.clave, e]));
    expect(llamaAUnGuard(porClave.get("pos/cuenta-pedido.ts|agregarItems")!.llamadas)).toBe(true);
    expect(llamaAUnGuard(porClave.get("pos/cuenta-pedido.ts|enviarACocina")!.llamadas)).toBe(true);
  });
});
