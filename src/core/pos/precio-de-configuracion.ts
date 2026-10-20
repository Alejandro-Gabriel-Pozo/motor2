import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import { totalDeLineas } from "@/core/moneda";
import { componerPrecioDeLinea, validarOpcionesElegidas, type OpcionElegida, type OpcionParaPrecio, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { GrupoParaVender, OpcionParaVender } from "./linea-configurada";
import { opcionParaPrecio } from "./opcion-para-precio";

/**
 * Los PRECIOS PARA MOSTRAR de un producto con opciones (GO-2d): el «desde», el precio final de cada tamaño, la diferencia de cada variante, el recargo de cada adicional y el total
 * de una configuración elegida. Función PURA y SIN `node:crypto` (no importa `linea-configurada.ts` en tiempo de ejecución, solo sus tipos): la usan el servidor (la ficha del
 * producto, la carta pública, el selector del POS) y, para la vista previa del diálogo de opciones, el cliente.
 *
 * La regla de cada precio es la MISMA que la venta (`armarLineaConfigurada`, `core/pos/linea-configurada.ts`): la diferencia del producto le gana a la de la opción; en un tamaño
 * con precio propio, la grilla de la sucursal le gana al precio del producto; la composición exacta es `componerPrecioDeLinea` y el descuento de producto va sobre la lista
 * compuesta, nunca sobre el adicional. El precio de cada opción es la MISMA función que usa la venta (`opcionParaPrecio`, `opcion-para-precio.ts`, que no importa
 * `linea-configurada.ts`); la paridad la fija `test/pos/precio-de-configuracion.test.ts`, que compara, para configuraciones al azar, este total con el de `armarLineaConfigurada`. NO decide lo que se cobra: al pedir, el servidor vuelve a armar la línea con lo vigente.
 */

/** Si una opción se puede elegir hoy en la sucursal: prendida para la empresa, admitida por el producto y no apagada (agotada) en la sucursal. */
export function opcionDisponible(opcion: Pick<OpcionParaVender, "activa" | "admitida" | "apagadaEnSucursal">): boolean {
  return opcion.activa && opcion.admitida && !opcion.apagadaEnSucursal;
}

/** Los grupos que cuentan para vender: los que el producto admite (fila activa) y están prendidos para la empresa. */
function gruposVigentes(grupos: readonly GrupoParaVender[]): GrupoParaVender[] {
  return grupos.filter((g) => g.admitido && g.activo);
}

/** Lo que aporta cada opción disponible de un grupo, para mostrarla («Mediano $ 2.800», «Con leche + $ 400», «Huevo frito + $ 600»). */
export interface OpcionConPrecio {
  opcionId: string;
  nombre: string;
  esNinguna: boolean;
  /** Solo en un TAMAÑO: el precio final del producto en ese tamaño (con el descuento de producto, si rige). */
  precioFinal: number | null;
  /** En una VARIANTE o una INCLUIDA: lo que suma o resta al precio, en pesos (0 = sin recargo). En un ADICIONAL: su recargo por unidad. */
  diferencia: number;
}

export interface GrupoConPrecios {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  /** Las opciones que se pueden elegir hoy (disponibles y con un precio que se compone bien), en el orden del grupo. */
  opciones: OpcionConPrecio[];
}

export interface ResumenDePrecios {
  /** Los grupos vigentes del producto, en su orden, con sus opciones disponibles. */
  grupos: GrupoConPrecios[];
  /**
   * El precio más bajo con el que se puede pedir (lo más barato de cada grupo obligatorio), con el descuento de producto si rige; `null` si no se puede vender (un grupo
   * obligatorio sin ninguna opción disponible).
   */
  desde: number | null;
  /** Si el precio cambia según lo que se elija (un tamaño o una variante con diferencia): solo entonces tiene sentido decir «desde». */
  hayVariacion: boolean;
  /** `false` si algún grupo obligatorio se quedó sin opciones disponibles (o está apagado): el producto no se puede vender hoy acá. */
  vendible: boolean;
}

/** Lo que aporta una sola opción, compuesta sola sobre el precio base (`null` si su precio no se compone: un tamaño sin precio, un modo de precio sin elegir). */
function aporteDe(grupo: GrupoParaVender, opcion: OpcionParaVender, precioBase: number): { lista: number; diferencia: number } | null {
  const r = componerPrecioDeLinea({ precioBase, cantidad: 1, opciones: [opcionParaPrecio(grupo, opcion, 1)] });
  if (!r.ok) return null;
  if (grupo.tipo === "ADICIONAL") return { lista: r.precio.precioDeLista, diferencia: r.precio.adicionales[0]?.recargoUnitario ?? 0 };
  return { lista: r.precio.precioDeLista, diferencia: r.precio.dentroDelPrecio[0]?.importeUnitario ?? 0 };
}

/**
 * Fase 4 de la ola «precio y carta» (ADR-035): el PRECIO DE REFERENCIA de un producto que se vende por opción (`modoDeVenta = BASE_CONFIGURABLE`): el precio final más barato de sus medidas en
 * ABSOLUTO vigentes y disponibles, ya resuelto con la grilla de la sucursal (la misma composición que la venta: una medida en ABSOLUTO reemplaza al precio base, así que se compone sobre 0). `null`
 * si no tiene ninguna con precio: entonces la base no se puede vender (falla cerrado, nunca cae al precio guardado).
 */
function precioDeReferenciaDeBase(vigentes: readonly GrupoParaVender[]): number | null {
  const precios = vigentes
    .filter((g) => g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO")
    .flatMap((g) => g.opciones.filter(opcionDisponible).flatMap((o) => aporteDe(g, o, 0)?.lista ?? []));
  return precios.length ? Math.min(...precios) : null;
}

/**
 * El resumen de precios de un producto con opciones en una sucursal: las opciones que se pueden elegir hoy con su precio, el «desde» y si se puede vender. Un producto sin grupos
 * vigentes devuelve `grupos: []`, `desde` = su precio (con descuento) y `hayVariacion: false`.
 *
 * `esBase` (Fase 4, ADR-035): el producto se vende por opción. Su precio guardado NO se usa: cada opción se compone sobre el precio de referencia (`precioDeReferenciaDeBase`), así una variante
 * sin costo se puede elegir aunque el guardado sea 0, y el resultado no depende de ese valor (en el cobro tampoco: con la medida en ABSOLUTO el precio base sale de la suma y una base no admite
 * porcentajes). Sin precio de referencia, no se puede vender.
 */
export function resumenDePrecios(entrada: { grupos: readonly GrupoParaVender[]; precioBase: number; descuentoDeProducto: number | null; esBase?: boolean }): ResumenDePrecios {
  const { descuentoDeProducto } = entrada;
  const final = (lista: number) => aplicarDescuentoDeProducto(lista, descuentoDeProducto).precio;
  const vigentes = gruposVigentes(entrada.grupos);
  const referencia = entrada.esBase ? precioDeReferenciaDeBase(vigentes) : null;
  const precioBase = referencia ?? entrada.precioBase;
  let vendible = !entrada.grupos.some((g) => g.admitido && !g.activo && g.cantidadMinima > 0) && !(entrada.esBase && referencia === null);
  let hayVariacion = false;
  const masBaratas: OpcionParaPrecio[] = [];

  const grupos: GrupoConPrecios[] = vigentes.map((g) => {
    const conPrecio = g.opciones.flatMap((o) => {
      if (!opcionDisponible(o)) return [];
      if (o.esNinguna && g.tipo === "ADICIONAL") return [{ opcion: o, aporte: { lista: precioBase, diferencia: 0 } }];
      const aporte = aporteDe(g, o, precioBase);
      return aporte ? [{ opcion: o, aporte }] : [];
    });
    if (g.cantidadMinima > 0 && conPrecio.length === 0) vendible = false;
    if (g.tipo === "MEDIDA" || (g.tipo === "VARIANTE" && conPrecio.some((c) => c.aporte.diferencia !== 0))) hayVariacion = true;
    // Lo más barato de cada grupo obligatorio (un adicional va en su propia línea: no entra en el «desde» del producto).
    if (g.cantidadMinima > 0 && g.tipo !== "ADICIONAL" && conPrecio.length > 0) {
      const barata = conPrecio.reduce((a, b) => (b.aporte.lista < a.aporte.lista ? b : a));
      if (!(barata.opcion.esNinguna && g.tipo === "MEDIDA")) masBaratas.push(opcionParaPrecio(g, barata.opcion, 1));
    }
    return {
      grupoId: g.grupoId,
      nombre: g.nombre,
      tipo: g.tipo,
      cantidadMinima: g.cantidadMinima,
      cantidadMaxima: g.cantidadMaxima,
      opciones: conPrecio.map(({ opcion, aporte }) => ({
        opcionId: opcion.opcionId,
        nombre: opcion.nombre,
        esNinguna: opcion.esNinguna,
        precioFinal: g.tipo === "MEDIDA" ? final(aporte.lista) : null,
        diferencia: aporte.diferencia,
      })),
    };
  });

  let desde: number | null = null;
  if (vendible) {
    const r = componerPrecioDeLinea({ precioBase, cantidad: 1, opciones: masBaratas });
    desde = r.ok ? final(r.precio.precioDeLista) : null;
    if (!r.ok) vendible = false;
  }
  return { grupos, desde, hayVariacion, vendible };
}

/** El total de una configuración elegida, para mostrarlo ANTES de confirmar. Los errores son los mismos códigos y mensajes de la validación y de la composición de la venta. */
export type VistaPreviaDeConfiguracion =
  | {
      ok: true;
      /** Precio por unidad de la línea del producto (con el descuento de producto, si rige). */
      precioUnitario: number;
      /** La lista compuesta, solo si el descuento cambió el precio. */
      precioLista: number | null;
      adicionales: { opcionId: string; nombre: string; cantidad: number; precioUnitario: number }[];
      /** Producto + adicionales, por la cantidad pedida: suma exacta, un redondeo. */
      total: number;
    }
  | { ok: false; codigo: string; mensaje: string; grupoId?: string };

export function vistaPreviaDeConfiguracion(entrada: {
  grupos: readonly GrupoParaVender[];
  elegidas: readonly OpcionElegida[];
  precioBase: number;
  descuentoDeProducto: number | null;
  cantidad: number;
}): VistaPreviaDeConfiguracion {
  const { grupos, elegidas, precioBase, descuentoDeProducto, cantidad } = entrada;
  const validacion = validarOpcionesElegidas(grupos, elegidas);
  if (!validacion.ok) return { ok: false, codigo: validacion.codigo, mensaje: validacion.mensaje, ...(validacion.grupoId ? { grupoId: validacion.grupoId } : {}) };
  const queCuentan = validacion.opciones
    .filter((v) => !(v.esNinguna && v.tipo === "ADICIONAL"))
    .map((v) => {
      const grupo = grupos.find((x) => x.grupoId === v.grupoId)!;
      return { grupo, opcion: grupo.opciones.find((o) => o.opcionId === v.opcionId)!, cantidad: v.cantidad };
    });
  const r = componerPrecioDeLinea({ precioBase, cantidad, opciones: queCuentan.map((e) => opcionParaPrecio(e.grupo, e.opcion, e.cantidad)) });
  if (!r.ok) return { ok: false, codigo: r.codigo, mensaje: r.mensaje };
  const aplicado = aplicarDescuentoDeProducto(r.precio.precioDeLista, descuentoDeProducto);
  const adicionales = r.precio.adicionales.map((a) => ({ opcionId: a.opcionId, nombre: a.nombre, cantidad: a.cantidad, precioUnitario: a.recargoUnitario }));
  return {
    ok: true,
    precioUnitario: aplicado.precio,
    precioLista: aplicado.precioLista,
    adicionales,
    total: totalDeLineas([{ cantidad, precioUnitario: aplicado.precio }, ...adicionales.map((a) => ({ cantidad: a.cantidad, precioUnitario: a.precioUnitario }))]),
  };
}
