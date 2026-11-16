import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONJUNTOS_DE_PORCIONES, MOTIVOS_DE_CANTIDAD, MOTIVOS_DE_CARGA, PORCIONES_PERMITIDAS, TIPOS_DE_FORMA } from "@/core/catalogo/fracciones-y-peso";
import { RESULTADOS_DE_CONVERSION } from "@/core/catalogo/conversion-de-paso-libre";

/**
 * GUARDIÁN DE DIMENSIONES de fracciones y peso (docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md §12, regla de combinaciones
 * del 2026-10-28). Falla si aparece una dimensión NUEVA sin declarar si afecta o no, en cuatro lugares del núcleo:
 *  (a) una clave nueva en las entradas de `decidirCantidadVendible`, `decidirCargarForma` o `convertirPasoLibre`;
 *  (b) una forma de venta, una porción, un conjunto de porciones o un resultado de conversión nuevo;
 *  (c) un motivo de rechazo nuevo.
 * Cada declaración lleva su motivo. Declarar «afecta: false» sin motivo no pasa.
 *
 * LÍMITES (alarma para errores honestos, no un límite de seguridad): lee el TEXTO del núcleo, no los tipos de TypeScript. Todavía no hay
 * columna `porcionesOfrecidas` ni perilla (llegan con E1 y E2, con su migración): esas etapas deben agregar acá el guardián de las columnas
 * que cruzan (`Producto.porcionesOfrecidas`, `pasoLibreOriginal`, la perilla de `Empresa`); mientras tanto el de «Duplicar producto»
 * (`test/catalogo/duplicar-producto-columnas.test.ts`) ya falla ante cualquier columna nueva de `Producto`. Las dimensiones del diseño que
 * este núcleo no cruza (precio, canal, permiso, anulación) las cruzan las etapas que conecten el núcleo a esas acciones.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

interface Declaracion {
  afecta: boolean;
  motivo: string;
}
const conMotivo = (d: Declaracion) => d.motivo.trim().length >= 8;

/** (a) Claves de las entradas de los tres puntos de decisión, por interfaz. */
const CLAVES: Record<string, Record<string, Declaracion>> = {
  "src/core/catalogo/fracciones-y-peso.ts": {
    forma: { afecta: true, motivo: "la forma de venta: decide el paso y qué cantidades valen (cinco tipos declarados abajo)." },
    cantidad: { afecta: true, motivo: "lo pedido, leído exacto en diezmilésimos: es el dato que se compara con el paso." },
    perillaEncendida: { afecta: true, motivo: "la perilla «Fracciones y peso»: pide encendida para cargar, y para vender el paso libre heredado (I7)." },
    destino: { afecta: true, motivo: "la forma a la que se quiere pasar el producto." },
    esProductoDeVenta: { afecta: true, motivo: "I4: fracciones y peso son solo de un producto que se vende." },
    magnitud: { afecta: true, motivo: "I3: fracciones solo en conteo, peso solo en masa (Unidad.magnitud)." },
    tipo: { afecta: true, motivo: "discriminante de la forma (UNIDAD, FRACCIONES, PESO, PASO_LIBRE, MASA_SIN_PASO)." },
    porciones: { afecta: true, motivo: "las fracciones ofrecidas: de ellas se deriva el paso (I2)." },
    paso: { afecta: true, motivo: "el paso de venta en diezmilésimos (peso y paso libre): decide el múltiplo exacto." },
    ok: { afecta: false, motivo: "forma del RESULTADO de una decisión (permitido o no), no una entrada." },
    motivo: { afecta: false, motivo: "forma del RESULTADO de una decisión rechazada, no una entrada; los motivos se declaran en (c)." },
  },
  "src/core/catalogo/conversion-de-paso-libre.ts": {
    pasoVenta: { afecta: true, motivo: "el paso libre actual (Producto.pasoVenta): el mapa lo lleva a la fracción más cercana." },
    porcionesActuales: { afecta: true, motivo: "si ya hay fracciones el producto ya está convertido (idempotencia, O26)." },
    magnitud: { afecta: true, motivo: "I3: las fracciones son de conteo; en otra magnitud no hay propuesta." },
    resultado: { afecta: true, motivo: "qué hace el mapa (cuatro resultados declarados abajo)." },
    porciones: { afecta: true, motivo: "la fracción propuesta o completada." },
    pasoResultante: { afecta: true, motivo: "el paso que queda al aplicar la fracción." },
    porcionesOfrecidas: { afecta: true, motivo: "lo que queda en el producto al revertir (O27): las fracciones se vacían." },
    pasoLibreOriginal: { afecta: true, motivo: "el paso que tenía antes de convertirse: la reversa lo restituye y nunca se pierde." },
  },
};

const DECLARADAS = {
  formas: Object.fromEntries(TIPOS_DE_FORMA.map((t) => [t, { afecta: true, motivo: "recorrida por el oráculo (test/catalogo/fracciones-y-peso-oraculo.ts)." }])) as Record<string, Declaracion>,
  porciones: { 2: { afecta: true, motivo: "½ = paso 0,5." }, 4: { afecta: true, motivo: "¼ = paso 0,25." }, 8: { afecta: true, motivo: "⅛ = paso 0,125." } } as Record<number, Declaracion>,
  resultados: Object.fromEntries(RESULTADOS_DE_CONVERSION.map((r) => [r, { afecta: true, motivo: "caso de la tabla de conversión del oráculo (O21 a O27)." }])) as Record<string, Declaracion>,
  motivosDeCantidad: Object.fromEntries(MOTIVOS_DE_CANTIDAD.map((m) => [m, { afecta: true, motivo: "recorrido por el oráculo de cantidad vendible." }])) as Record<string, Declaracion>,
  motivosDeCarga: Object.fromEntries(MOTIVOS_DE_CARGA.map((m) => [m, { afecta: true, motivo: "caso de la tabla de carga de forma." }])) as Record<string, Declaracion>,
};

describe("guardián de dimensiones de fracciones y peso (regla de combinaciones, 2026-10-28)", () => {
  it("(a) cada clave de las entradas del núcleo está declarada, y toda declaración tiene motivo", () => {
    for (const [archivo, declaradas] of Object.entries(CLAVES)) {
      const fuente = leer(archivo);
      const claves = new Set([...fuente.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]!));
      expect(claves.size, `no se pudieron leer las claves de ${archivo}`).toBeGreaterThan(3);
      const sinDeclarar = [...claves].filter((c) => !(c in declaradas));
      expect(sinDeclarar, `dimensión nueva en ${archivo} sin declarar si afecta o no: ${sinDeclarar.join(", ")} (agregala a CLAVES con su motivo y a la tabla del oráculo)`).toEqual([]);
      const sobrantes = Object.keys(declaradas).filter((c) => !claves.has(c));
      expect(sobrantes, `declarada pero ya no existe en ${archivo}`).toEqual([]);
      for (const d of Object.values(declaradas)) expect(conMotivo(d)).toBe(true);
    }
  });

  it("(b) las formas, las porciones, los conjuntos y los resultados son exactamente los declarados", () => {
    expect([...TIPOS_DE_FORMA].sort()).toEqual(Object.keys(DECLARADAS.formas).sort());
    expect([...PORCIONES_PERMITIDAS].map(String).sort()).toEqual(Object.keys(DECLARADAS.porciones).sort());
    expect(CONJUNTOS_DE_PORCIONES, "los conjuntos son los siete del diseño (2^3 - 1)").toHaveLength(7);
    expect([...RESULTADOS_DE_CONVERSION].sort()).toEqual(Object.keys(DECLARADAS.resultados).sort());
    for (const grupo of [DECLARADAS.formas, DECLARADAS.porciones, DECLARADAS.resultados]) for (const d of Object.values(grupo)) expect(conMotivo(d)).toBe(true);
  });

  it("(c) los motivos de rechazo son exactamente los declarados", () => {
    expect([...MOTIVOS_DE_CANTIDAD].sort()).toEqual(Object.keys(DECLARADAS.motivosDeCantidad).sort());
    expect([...MOTIVOS_DE_CARGA].sort()).toEqual(Object.keys(DECLARADAS.motivosDeCarga).sort());
  });
});
