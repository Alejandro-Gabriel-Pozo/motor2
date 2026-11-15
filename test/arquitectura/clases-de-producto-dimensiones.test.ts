import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLASES_DE_PRODUCTO, MOTIVOS_DE_RECHAZO_DE_CLASE, OPERACIONES_DE_CLASE } from "@/core/catalogo/clases-de-producto";

/**
 * GUARDIÁN DE DIMENSIONES de las clases de producto (docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md §10.1, regla de
 * combinaciones del 2026-10-28). Falla si aparece una dimensión NUEVA sin declarar si afecta o no, en cuatro lugares del núcleo:
 *  (a) una clave nueva en la entrada de `decidirSobreClase` (`EntradaDeClase`) o en sus hechos (`HechosDeClase`);
 *  (b) una operación nueva;
 *  (c) una clase nueva (una sexta: el diseño dice que no hay ninguna, «la lista es cerrada»);
 *  (d) un motivo de rechazo nuevo.
 * Cada declaración lleva su motivo. Declarar «afecta: false» sin motivo no pasa.
 *
 * LÍMITES (alarma para errores honestos, no un límite de seguridad): lee el TEXTO del núcleo, no los tipos de TypeScript. Todavía no
 * hay columna `claseDeUso` en `Producto` (llega con la etapa E1, con su migración): cuando exista, E1 debe agregar acá el guardián de
 * las columnas de `Producto` que la cruzan; mientras tanto, el de «Duplicar producto» (`test/catalogo/duplicar-producto-columnas.test.ts`)
 * ya falla ante cualquier columna nueva de `Producto`.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const ARCHIVO = "src/core/catalogo/clases-de-producto.ts";

interface Declaracion {
  afecta: boolean;
  motivo: string;
}
const conMotivo = (d: Declaracion) => d.motivo.trim().length >= 8;

/** (a) Claves de la entrada del núcleo. */
const CLAVES_DE_ENTRADA: Record<string, Declaracion> = {
  clase: { afecta: true, motivo: "la clase del producto: cinco valores cerrados; decide casi todas las operaciones." },
  operacion: { afecta: true, motivo: "la operación que se quiere hacer (nueve declaradas más abajo)." },
  hechos: { afecta: true, motivo: "el contenedor de los hechos del producto además de su clase." },
  seProduce: { afecta: true, motivo: "marca «se produce»: solo cambia el stock propio del vendible (el test «se produce solo cambia una decisión» lo fija)." },
};

/** (b) Operaciones: cada una recorrida por el oráculo (REGLAS_POR_OPERACION). */
const OPERACIONES_DECLARADAS: Record<(typeof OPERACIONES_DE_CLASE)[number], Declaracion> = {
  vender: { afecta: true, motivo: "dinero y carta: solo las clases que venden." },
  llevar_datos_de_venta: { afecta: true, motivo: "alícuota, sección, nombre de cocina, descripción, precio y opciones: solo las que venden (I3)." },
  estar_en_la_carta: { afecta: true, motivo: "visibilidad: la carta y el POS solo muestran lo que vende." },
  comprar: { afecta: true, motivo: "dinero y stock: solo materia prima, insumo y reventa (I4)." },
  producir: { afecta: true, motivo: "stock: solo elaborado y vendible." },
  llevar_receta: { afecta: true, motivo: "composición: solo elaborado y vendible." },
  entrar_en_receta: { afecta: true, motivo: "stock y costo: el insumo no entra (2026-11-14), el vendible tampoco (I6)." },
  ser_consumido_por_opcion: { afecta: true, motivo: "stock: lo que una opción consume (I5, P4)." },
  tener_stock_propio: { afecta: true, motivo: "stock: el vendible solo si se produce." },
};

/** (c) Clases: cada una declarada con su razón de existir (el diseño: las cinco de Pedernal, ninguna más). */
const CLASES_DECLARADAS: Record<(typeof CLASES_DE_PRODUCTO)[number], Declaracion> = {
  MATERIA_PRIMA: { afecta: true, motivo: "se compra y es componente de lo que se elabora y se vende." },
  INSUMO: { afecta: true, motivo: "se compra y se consume para operar; fuera de receta y de food cost." },
  REVENTA: { afecta: true, motivo: "se compra y se vende tal cual." },
  ELABORADO: { afecta: true, motivo: "se produce en el negocio y se usa como componente." },
  VENDIBLE: { afecta: true, motivo: "se arma o se produce y se vende; tiene composición." },
};

/** (d) Motivos de rechazo: cada uno corresponde a un mensaje que decidirá la etapa que conecte el núcleo. */
const MOTIVOS_DECLARADOS: Record<(typeof MOTIVOS_DE_RECHAZO_DE_CLASE)[number], Declaracion> = {
  CLASE_DESCONOCIDA: { afecta: true, motivo: "falla cerrado: un valor que no es de la lista." },
  OPERACION_DESCONOCIDA: { afecta: true, motivo: "falla cerrado: una operación que el núcleo no declara." },
  LA_CLASE_NO_VENDE: { afecta: true, motivo: "vender o estar en la carta con una clase que no vende." },
  CAMPO_NO_ADMITIDO_POR_LA_CLASE: { afecta: true, motivo: "nombre de Pedernal: un dato de venta en una clase que no vende." },
  PRODUCTO_NO_COMPRABLE: { afecta: true, motivo: "nombre de Pedernal: comprar un elaborado o un vendible." },
  LA_CLASE_NO_SE_PRODUCE: { afecta: true, motivo: "producir una clase que no se produce." },
  PRODUCTO_NO_LLEVA_RECETA: { afecta: true, motivo: "nombre de Pedernal: receta en una clase sin composición." },
  COMPONENTE_ES_INSUMO: { afecta: true, motivo: "nombre de Pedernal: el insumo no entra en receta." },
  COMPONENTE_NO_ES_INGREDIENTE: { afecta: true, motivo: "el vendible no es ingrediente de otra receta." },
  INSUMO_NO_ADMITIDO: { afecta: true, motivo: "nombre de Pedernal: lo que una opción no puede consumir." },
  SIN_STOCK_PROPIO: { afecta: true, motivo: "un vendible que no se produce no lleva stock propio." },
};

describe("guardián de dimensiones de las clases de producto (regla de combinaciones, 2026-10-28)", () => {
  it("(a) cada clave de la entrada del núcleo está declarada, y toda declaración tiene motivo", () => {
    const fuente = leer(ARCHIVO);
    const hechos = /export interface HechosDeClase \{([\s\S]*?)\n\}/.exec(fuente)?.[1] ?? "";
    const entrada = /export interface EntradaDeClase \{([\s\S]*?)\n\}/.exec(fuente)?.[1] ?? "";
    const claves = new Set([...hechos.matchAll(/readonly (\w+):/g), ...entrada.matchAll(/readonly (\w+):/g)].map((m) => m[1]!));
    expect(claves.size, "no se pudieron leer las claves del núcleo: ¿cambió la forma del archivo?").toBeGreaterThanOrEqual(3);
    const sinDeclarar = [...claves].filter((c) => !(c in CLAVES_DE_ENTRADA));
    expect(sinDeclarar, `dimensión nueva sin declarar si afecta o no: ${sinDeclarar.join(", ")} (agregala a CLAVES_DE_ENTRADA con su motivo y a la tabla del oráculo)`).toEqual([]);
    const sobrantes = Object.keys(CLAVES_DE_ENTRADA).filter((c) => !claves.has(c));
    expect(sobrantes, "declarada pero ya no existe en el núcleo").toEqual([]);
    for (const d of Object.values(CLAVES_DE_ENTRADA)) expect(conMotivo(d)).toBe(true);
  });

  it("(b) las operaciones del núcleo son exactamente las declaradas", () => {
    expect([...OPERACIONES_DE_CLASE].sort()).toEqual(Object.keys(OPERACIONES_DECLARADAS).sort());
    for (const d of Object.values(OPERACIONES_DECLARADAS)) expect(conMotivo(d)).toBe(true);
  });

  it("(c) las clases son exactamente las cinco declaradas (una sexta se declara acá, en el oráculo y en el diseño)", () => {
    expect([...CLASES_DE_PRODUCTO].sort()).toEqual(Object.keys(CLASES_DECLARADAS).sort());
    expect(CLASES_DE_PRODUCTO).toHaveLength(5);
    for (const d of Object.values(CLASES_DECLARADAS)) expect(conMotivo(d)).toBe(true);
  });

  it("(d) los motivos de rechazo son exactamente los declarados", () => {
    expect([...MOTIVOS_DE_RECHAZO_DE_CLASE].sort()).toEqual(Object.keys(MOTIVOS_DECLARADOS).sort());
    for (const d of Object.values(MOTIVOS_DECLARADOS)) expect(conMotivo(d)).toBe(true);
  });
});
