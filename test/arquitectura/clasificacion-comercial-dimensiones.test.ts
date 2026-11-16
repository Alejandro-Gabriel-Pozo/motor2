import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as nucleo from "@/core/catalogo/clasificacion-comercial";

/**
 * GUARDIÁN DE DIMENSIONES de la clasificación comercial (regla de combinaciones, AGENTS.md 2026-10-28; diseño
 * docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md). Falla si aparece una dimensión NUEVA sin declarar si afecta o no a las reglas:
 *  (a) un campo nuevo de `NodoDeClasificacion` (la foto que reciben las reglas);
 *  (b) un motivo de rechazo nuevo, o una función exportada nueva del núcleo;
 *  (c) una columna nueva de `CategoriaProducto`, la tabla que la etapa con base ampliará para ser el nodo (`padreId`, `nombreClave`, `version`):
 *      ese día este test obliga a declararlas;
 *  (d) el tope de niveles por debajo del que ya rige (nunca reducible: reducirlo dejaría árboles que ya no lo cumplen).
 * Cada declaración lleva su motivo; «afecta: false» sin motivo no pasa. El oráculo es `test/catalogo/clasificacion-comercial-oraculo.ts`.
 * LÍMITES (alarma para errores honestos, no un límite de seguridad): lee el TEXTO del núcleo y del esquema, no los tipos de TypeScript; una exportación
 * con otra forma (`export { a }`) o un campo del tipo escrito en otra forma no se ve.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), "utf8");
const conMotivo = (d: Declaracion): boolean => d.motivo.trim().length >= 8;

interface Declaracion {
  afecta: boolean;
  motivo: string;
}

const CAMPOS_DEL_NODO: Record<string, Declaracion> = {
  id: { afecta: true, motivo: "identifica al nodo: el camino, el ciclo y el movimiento a sí mismo se deciden por id." },
  padreId: { afecta: true, motivo: "la estructura del árbol: nivel, camino, ciclo, tope y hermanos salen de acá (null = departamento)." },
  activo: { afecta: true, motivo: "decide crear bajo un padre, mover, desactivar (hijos activos) y reactivar (padre activo)." },
  nombreClave: { afecta: true, motivo: "decide el nombre único entre hermanos al crear, renombrar y mover (desactivados incluidos)." },
};

const MOTIVOS: Record<string, Declaracion> = Object.fromEntries(
  nucleo.MOTIVOS_DE_RECHAZO_DE_CLASIFICACION.map((m) => [m, { afecta: true, motivo: "recorrido por el oráculo (test/catalogo/clasificacion-comercial-oraculo.ts)." } as Declaracion]),
);

const FUNCIONES: Record<string, Declaracion> = {
  nombreDeNodoDesdeTexto: { afecta: true, motivo: "el nombre del nodo: ficha ELECCION (1 a 80), probada en test/catalogo/clasificacion-comercial.test.ts." },
  caminoDeNodo: { afecta: true, motivo: "camino del departamento al nodo; oráculo V-1 a V-3." },
  nivelDeNodo: { afecta: true, motivo: "largo del camino; oráculo V-1 a V-3." },
  puedeCrearBajo: { afecta: true, motivo: "oráculo C-1 a C-6." },
  puedeRenombrar: { afecta: true, motivo: "oráculo N-1 a N-3." },
  puedeMover: { afecta: true, motivo: "oráculo M-1 a M-10." },
  destinosParaMover: { afecta: true, motivo: "los destinos válidos de un movimiento; comparados con el oráculo en cada recorrido." },
  puedeDesactivar: { afecta: true, motivo: "oráculo D-1 a D-3." },
  puedeReactivar: { afecta: true, motivo: "oráculo A-1 a A-5." },
};

/** Constantes y tipos exportados que no son reglas: se listan para que una exportación nueva no pase sin mirar. */
const OTRAS_EXPORTACIONES: Record<string, Declaracion> = {
  MAXIMO_DE_NIVELES_DE_CLASIFICACION: { afecta: true, motivo: "el tope de niveles; el oráculo lo importa y el guardián (d) fija que no baje de 4." },
  MOTIVOS_DE_RECHAZO_DE_CLASIFICACION: { afecta: true, motivo: "el conjunto cerrado de motivos; declarado arriba uno por uno." },
  NodoDeClasificacion: { afecta: true, motivo: "la foto de un nodo; sus campos están declarados arriba." },
  ArbolDeClasificacion: { afecta: true, motivo: "la foto del árbol de UNA empresa (id → nodo)." },
  MotivoDeRechazoDeClasificacion: { afecta: true, motivo: "el tipo de los motivos cerrados." },
  MotivoDeArbol: { afecta: true, motivo: "los dos motivos de las lecturas del árbol (camino y nivel)." },
};

/** (c) Columnas de la tabla que será el nodo. */
const COLUMNAS_DE_CATEGORIA: Record<string, Declaracion> = {
  id: { afecta: true, motivo: "será el id del nodo; se conserva (las categorías de hoy pasan a ser departamentos)." },
  empresaId: { afecta: false, motivo: "aislamiento por empresa: la foto ya llega filtrada por empresa." },
  empresa: { afecta: false, motivo: "relación de empresaId." },
  nombre: { afecta: true, motivo: "de acá sale el nombre del nodo y su clave (ficha ELECCION)." },
  activo: { afecta: true, motivo: "el estado activo del nodo." },
  productos: { afecta: false, motivo: "relación inversa de Producto.categoriaId; las reglas del árbol no miran productos." },
  margenesObjetivo: { afecta: false, motivo: "relación inversa del food cost objetivo; el departamento no hereda nada." },
};

describe("guardián de dimensiones de la clasificación comercial (regla de combinaciones, 2026-10-28)", () => {
  const fuente = leer("src/core/catalogo/clasificacion-comercial.ts");

  it("(a) cada campo de la foto de un nodo está declarado, con su motivo", () => {
    const cuerpo = /export type NodoDeClasificacion = Readonly<\{([\s\S]*?)\n\}>;/.exec(fuente)?.[1] ?? "";
    const campos = new Set([...cuerpo.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!));
    expect(campos.size, "no se pudieron leer los campos del nodo: ¿cambió la forma del archivo?").toBeGreaterThan(2);
    expect([...campos].filter((c) => !(c in CAMPOS_DEL_NODO)), "campo nuevo del nodo sin declarar si afecta o no (agregalo con su motivo y a una regla del oráculo)").toEqual([]);
    expect(Object.keys(CAMPOS_DEL_NODO).filter((c) => !campos.has(c)), "declarado pero ya no existe en el nodo").toEqual([]);
    for (const d of Object.values(CAMPOS_DEL_NODO)) expect(conMotivo(d)).toBe(true);
  });

  it("(b) los motivos de rechazo y las exportaciones del núcleo están declarados, y no sobra ninguno", () => {
    const exportadas = [...fuente.matchAll(/^export (?:async )?(?:function|const|type|class|interface|enum) (\w+)/gm)].map((m) => m[1]!);
    const funciones = exportadas.filter((n) => n in FUNCIONES || /^[a-z]/.test(n));
    const sinDeclarar = exportadas.filter((n) => !(n in FUNCIONES) && !(n in OTRAS_EXPORTACIONES));
    expect(sinDeclarar, `exportación nueva del núcleo sin declarar si afecta o no: ${sinDeclarar.join(", ")} (si es una regla, agregala al oráculo)`).toEqual([]);
    expect(Object.keys(FUNCIONES).filter((n) => !funciones.includes(n)), "función declarada que ya no existe").toEqual([]);
    expect(Object.keys(OTRAS_EXPORTACIONES).filter((n) => !exportadas.includes(n)), "exportación declarada que ya no existe").toEqual([]);
    expect(Object.keys(MOTIVOS).sort()).toEqual([...nucleo.MOTIVOS_DE_RECHAZO_DE_CLASIFICACION].sort());
    for (const d of [...Object.values(FUNCIONES), ...Object.values(OTRAS_EXPORTACIONES), ...Object.values(MOTIVOS)]) expect(conMotivo(d)).toBe(true);
  });

  it("(c) cada columna de CategoriaProducto está declarada (la etapa con base la amplía: padreId, nombreClave, version)", () => {
    const bloque = new RegExp("^model CategoriaProducto \\{([\\s\\S]*?)^\\}", "m").exec(leer("prisma/schema.prisma"))?.[1] ?? "";
    const campos = bloque.split("\n").map((l) => /^\s{2}([A-Za-z]\w*)\s/.exec(l)?.[1]).filter((c): c is string => !!c);
    expect(campos.length, "no se pudo leer el modelo CategoriaProducto").toBeGreaterThan(3);
    expect(campos.filter((c) => !(c in COLUMNAS_DE_CATEGORIA)), "columna nueva de CategoriaProducto sin declarar si afecta o no a las reglas del árbol").toEqual([]);
    expect(Object.keys(COLUMNAS_DE_CATEGORIA).filter((c) => !campos.includes(c)), "declarada pero ya no existe en CategoriaProducto").toEqual([]);
    for (const d of Object.values(COLUMNAS_DE_CATEGORIA)) expect(conMotivo(d)).toBe(true);
  });

  it("(d) el tope de niveles nunca baja de 4 (reducirlo dejaría árboles que ya no lo cumplen)", () => {
    expect(nucleo.MAXIMO_DE_NIVELES_DE_CLASIFICACION).toBeGreaterThanOrEqual(4);
  });
});
