/**
 * «¿Qué es?» del alta de un producto, como Pedernal (diseño corto `docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md`; pedido del dueño, 2026-11-17, chat con el orquestador:
 * «un nuevo producto no tiene todas las categorías que tiene el otro […] Esas son cosas que Pedernal sacó»). SOLO PANTALLA: no hay columna nueva; cada clase se guarda con los datos de siempre.
 *
 * Hoy se ofrecen las TRES clases que se pueden guardar sin tocar el modelo (Materia prima = tipo MP; Elaborado = tipo MP que se produce; Producto vendible = tipo PV). Insumo y Reventa de Pedernal
 * necesitan la columna `claseDeUso` (diseño de clases E1 y E4): hasta que exista no se ofrecen ni se inventan.
 *
 * Los nombres y las descripciones cortas salen del núcleo puro de las cinco clases (`clases-de-producto.ts`), copiados LITERALES de Pedernal (`ZuluHub-docs` `10-ux-ui/prototipos-gastronomia/productos.html`, `CLASES`); el dueño confirmó copiarlas: «Las 5 de Pedernal»
 * (2026-11-13) y «Sí, copiar a Pedernal en esas cinco» (2026-11-15).
 */

import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { DESCRIPCION_DE_CLASE, NOMBRE_DE_CLASE } from "./clases-de-producto";

/** Interruptor reversible: en `false` el alta vuelve a los dos botones MP/PV y a las casillas «Se produce…» y «Activo en todas las sucursales» (sin migración ni datos). */
export const ALTA_DE_PRODUCTO_COMO_PEDERNAL: boolean = true;

export const CLASES_DE_ALTA = {
  MATERIA_PRIMA: { nombre: NOMBRE_DE_CLASE.MATERIA_PRIMA, descripcion: DESCRIPCION_DE_CLASE.MATERIA_PRIMA, tipo: "MP", seProduce: false },
  ELABORADO: { nombre: NOMBRE_DE_CLASE.ELABORADO, descripcion: DESCRIPCION_DE_CLASE.ELABORADO, tipo: "MP", seProduce: true },
  VENDIBLE: { nombre: NOMBRE_DE_CLASE.VENDIBLE, descripcion: DESCRIPCION_DE_CLASE.VENDIBLE, tipo: "PV", seProduce: false },
} as const;

export type ClaveDeClaseDeAlta = keyof typeof CLASES_DE_ALTA;
/** Orden en que se ofrecen (el de Pedernal, sin las dos que todavía no existen en el modelo). */
export const CLAVES_DE_CLASE_DE_ALTA: readonly ClaveDeClaseDeAlta[] = ["MATERIA_PRIMA", "ELABORADO", "VENDIBLE"];

/** La clase de un producto ya guardado, deducida de lo que existe: un producto de venta es vendible; una materia prima que se produce es elaborada; el resto, materia prima. */
export function claseDeAltaDe(producto: { tipo: TipoProducto; seProduce?: boolean }): ClaveDeClaseDeAlta {
  if (producto.tipo === "PV") return "VENDIBLE";
  return producto.seProduce === true ? "ELABORADO" : "MATERIA_PRIMA";
}
