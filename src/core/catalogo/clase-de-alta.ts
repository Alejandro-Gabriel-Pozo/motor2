/**
 * «¿Qué es?» del alta de un producto, como Pedernal (diseño corto `docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md`; pedido del dueño, 2026-11-17, chat con el orquestador:
 * «un nuevo producto no tiene todas las categorías que tiene el otro […] Esas son cosas que Pedernal sacó»). SOLO PANTALLA: no hay columna nueva; cada clase se guarda con los datos de siempre.
 *
 * Con la columna `claseDeUso` (E1, migración 20261117180000) el alta guarda la clase elegida (E2) y ofrece las CINCO de Pedernal: Materia prima, Insumo, Reventa, Elaborado y Producto vendible; cada una con el tipo y
 * «se produce» de siempre. Reventa (se compra y se vende tal cual) se ofrece desde E4-5: es un producto de venta (PV) que no se produce y lleva su propia clase guardada (`REVENTA`), con el stock propio y la compra de E4-0 a E4-4.
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
  INSUMO: { nombre: NOMBRE_DE_CLASE.INSUMO, descripcion: DESCRIPCION_DE_CLASE.INSUMO, tipo: "MP", seProduce: false },
  REVENTA: { nombre: NOMBRE_DE_CLASE.REVENTA, descripcion: DESCRIPCION_DE_CLASE.REVENTA, tipo: "PV", seProduce: false },
  ELABORADO: { nombre: NOMBRE_DE_CLASE.ELABORADO, descripcion: DESCRIPCION_DE_CLASE.ELABORADO, tipo: "MP", seProduce: true },
  VENDIBLE: { nombre: NOMBRE_DE_CLASE.VENDIBLE, descripcion: DESCRIPCION_DE_CLASE.VENDIBLE, tipo: "PV", seProduce: false },
} as const;

export type ClaveDeClaseDeAlta = keyof typeof CLASES_DE_ALTA;
/** Orden en que se ofrecen (el de Pedernal). */
export const CLAVES_DE_CLASE_DE_ALTA: readonly ClaveDeClaseDeAlta[] = ["MATERIA_PRIMA", "INSUMO", "REVENTA", "ELABORADO", "VENDIBLE"];
/** Interruptor (todo nace cerrado): Insumo y Reventa se ven en el desplegable «¿Qué es?» y el chip «Reventa» de la lista solo con él encendido; apagado la pantalla ofrece lo de siempre (Materia prima, Elaborado, Producto vendible). El servidor ya las admite. */
export const CLASES_NUEVAS_VISIBLES: boolean = false;
/** Las clases que la PANTALLA ofrece hoy (en el orden de Pedernal). */
export const CLAVES_OFRECIDAS_EN_PANTALLA: readonly ClaveDeClaseDeAlta[] = CLAVES_DE_CLASE_DE_ALTA.filter((c) => CLASES_NUEVAS_VISIBLES || (c !== "INSUMO" && c !== "REVENTA"));

/**
 * La clase de un producto ya guardado: la que tiene escrita (`claseDeUso`, E1/E2) si es de las que se ofrecen; si no (todo lo cargado antes de las clases), la que sale de lo que
 * existe: un producto de venta es vendible; una materia prima que se produce es elaborada; el resto, materia prima.
 */
export function claseDeAltaDe(producto: { tipo: TipoProducto; seProduce?: boolean; claseDeUso?: string | null }): ClaveDeClaseDeAlta {
  const guardada = CLAVES_DE_CLASE_DE_ALTA.find((c) => c === producto.claseDeUso);
  if (guardada !== undefined) return guardada;
  if (producto.tipo === "PV") return "VENDIBLE";
  return producto.seProduce === true ? "ELABORADO" : "MATERIA_PRIMA";
}

/**
 * ¿La clase que trae un alta es una de las que se ofrecen y coincide con el tipo y «se produce» que trae el mismo pedido? Devuelve el motivo del rechazo, o `null` si está bien. Lista de PERMITIDOS: una clase que no
 * está en `CLASES_DE_ALTA` (Reventa solo con tipo PV y que no se produce) o que no coincide con el tipo y «se produce» se rechaza. Solo para el ALTA: la clase se escribe una vez y no cambia (disparador de la base).
 */
export function motivoDeClaseDeAltaInvalida(pedido: { claseDeUso: unknown; tipo: "MP" | "PV"; seProduce: boolean | undefined }): string | null {
  const clase = typeof pedido.claseDeUso === "string" ? CLAVES_DE_CLASE_DE_ALTA.find((c) => c === pedido.claseDeUso) : undefined;
  if (clase === undefined) return "La clase del producto no es una de las que se pueden elegir.";
  const esperado = CLASES_DE_ALTA[clase];
  if (esperado.tipo !== pedido.tipo || esperado.seProduce !== (pedido.seProduce ?? false)) return "La clase elegida no coincide con lo que se cargó del producto.";
  return null;
}
