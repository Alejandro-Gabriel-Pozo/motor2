import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import { totalDeLineas } from "@/core/moneda";
import { componerPrecioDeLinea, entradaConPrecioDeCombinacion, validarOpcionesElegidas, type OpcionElegida, type OpcionParaPrecio, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { combinacionElegida, combinacionesDesdeMostrar, type CombinacionesParaMostrar } from "./combinacion-elegida";
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
 * El resumen de precios de un producto con opciones en una sucursal: las opciones que se pueden elegir hoy con su precio, el «desde» y si se puede vender. Un producto sin grupos
 * vigentes devuelve `grupos: []`, `desde` = su precio (con descuento) y `hayVariacion: false`.
 */
export function resumenDePrecios(entrada: { grupos: readonly GrupoParaVender[]; precioBase: number; descuentoDeProducto: number | null }): ResumenDePrecios {
  const { precioBase, descuentoDeProducto } = entrada;
  const final = (lista: number) => aplicarDescuentoDeProducto(lista, descuentoDeProducto).precio;
  const vigentes = gruposVigentes(entrada.grupos);
  let vendible = !entrada.grupos.some((g) => g.admitido && !g.activo && g.cantidadMinima > 0);
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

/**
 * GO-3b (ADR-032): con `combinaciones` (las del producto con ejes, en su forma serializable), la combinación elegida decide igual que en la venta (`combinacionElegida`, la MISMA función): apagada es
 * `COMBINACION_NO_DISPONIBLE`; con precio propio, de la tarifa o local, ese es el precio del producto en esos ejes. Un producto con ejes y sin `combinaciones` falla cerrado, como la venta.
 */
export function vistaPreviaDeConfiguracion(entrada: {
  grupos: readonly GrupoParaVender[];
  elegidas: readonly OpcionElegida[];
  precioBase: number;
  descuentoDeProducto: number | null;
  cantidad: number;
  combinaciones?: CombinacionesParaMostrar;
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
  const elegida = combinacionElegida(grupos, queCuentan, entrada.combinaciones ? combinacionesDesdeMostrar(entrada.combinaciones) : undefined);
  if (!elegida.ok) return { ok: false, codigo: elegida.codigo, mensaje: elegida.mensaje };
  const entradaDePrecio = { precioBase, cantidad, opciones: queCuentan.map((e) => opcionParaPrecio(e.grupo, e.opcion, e.cantidad)) };
  const r = componerPrecioDeLinea(elegida.precio === null ? entradaDePrecio : entradaConPrecioDeCombinacion(entradaDePrecio, elegida.precio, elegida.opcionesDeEjes));
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

/**
 * GO-3b (ADR-032): las opciones de un EJE que, con lo que ya está elegido en el otro eje (o solas, si hay un eje solo), caen en una combinación APAGADA (la fila o su tarifa): el diálogo las muestra
 * deshabilitadas («No disponible») en vez de dejar que el mozo arme algo que la venta va a rechazar. Con dos ejes y el otro todavía sin elegir, no se deshabilita nada (no se sabe todavía).
 */
export function opcionesConCombinacionApagada(grupos: readonly GrupoParaVender[], elegidas: readonly { opcionId: string }[], combinaciones: CombinacionesParaMostrar | undefined): Set<string> {
  const apagadas = new Set<string>();
  if (!combinaciones) return apagadas;
  const ejes = [...grupos].filter((g) => g.ejeDeCombinacion !== undefined).sort((a, b) => a.ejeDeCombinacion! - b.ejeDeCombinacion!);
  if (ejes.length === 0) return apagadas;
  const filas = new Map(combinaciones.filas.map((f) => [f.clave, f]));
  const elegidas_ = new Set(elegidas.map((e) => e.opcionId));
  const elegidaDe = (g: GrupoParaVender) => g.opciones.find((o) => elegidas_.has(o.opcionId) && !o.esNinguna)?.opcionId ?? null;
  for (const g of ejes) {
    const otro = ejes.find((x) => x !== g);
    const delOtro = otro ? elegidaDe(otro) : null;
    if (otro && delOtro === null) continue;
    for (const o of g.opciones) {
      if (o.esNinguna) continue;
      const [uno, dos] = g.ejeDeCombinacion === 1 ? [o.opcionId, delOtro] : [delOtro!, o.opcionId];
      const fila = filas.get(`${uno}|${dos ?? ""}`);
      if (fila && (!fila.activa || (fila.grupo !== null && !fila.grupo.activo))) apagadas.add(o.opcionId);
    }
  }
  return apagadas;
}

/**
 * GO-3b (ADR-032): el resumen de precios de un producto con EJES, corregido por sus combinaciones (la misma regla que la venta): con UN eje, cada opción del eje muestra el precio de SU combinación (y una
 * apagada no se ofrece); el «desde» es el más barato de las combinaciones que se pueden pedir (cada una con lo más barato de los demás grupos obligatorios). Con dos ejes, el precio de cada opción
 * depende del otro eje: se deja el de la regla general y el «desde» recorre todos los pares. Sin `combinaciones`, el resumen de siempre.
 */
export function resumenDePreciosConCombinaciones(entrada: { grupos: readonly GrupoParaVender[]; precioBase: number; descuentoDeProducto: number | null; combinaciones?: CombinacionesParaMostrar }): ResumenDePrecios {
  const base = resumenDePrecios(entrada);
  const { combinaciones } = entrada;
  const ejes = entrada.grupos.filter((g) => g.ejeDeCombinacion !== undefined && g.admitido && g.activo).sort((a, b) => a.ejeDeCombinacion! - b.ejeDeCombinacion!);
  if (!combinaciones || ejes.length === 0 || !base.vendible) return base;
  // Lo más barato de cada grupo obligatorio que no es eje (como en el «desde» de siempre).
  const masBaratas = base.grupos
    .filter((g) => g.cantidadMinima > 0 && g.tipo !== "ADICIONAL" && !ejes.some((e) => e.grupoId === g.grupoId) && g.opciones.length > 0)
    .map((g) => {
      const barata = g.opciones.reduce((a, b) => ((b.precioFinal ?? b.diferencia) < (a.precioFinal ?? a.diferencia) ? b : a));
      return { opcionId: barata.opcionId, cantidad: 1 };
    });
  const disponiblesDe = (grupoId: string) => (base.grupos.find((g) => g.grupoId === grupoId)?.opciones ?? []).filter((o) => !o.esNinguna).map((o) => o.opcionId);
  const precioDe = (ejeIds: string[]) => {
    const v = vistaPreviaDeConfiguracion({ ...entrada, elegidas: [...ejeIds.map((opcionId) => ({ opcionId, cantidad: 1 })), ...masBaratas], cantidad: 1 });
    return v.ok ? v.precioUnitario : null;
  };
  const pares: string[][] = ejes.length === 1 ? disponiblesDe(ejes[0]!.grupoId).map((a) => [a]) : disponiblesDe(ejes[0]!.grupoId).flatMap((a) => disponiblesDe(ejes[1]!.grupoId).map((b) => [a, b]));
  const precios = pares.map((p) => ({ par: p, precio: precioDe(p) }));
  const vendibles = precios.flatMap((p) => (p.precio === null ? [] : [p.precio]));
  const desde = vendibles.length ? Math.min(...vendibles) : null;
  let grupos = base.grupos;
  if (ejes.length === 1) {
    const eje = ejes[0]!;
    const porOpcion = new Map(precios.map((p) => [p.par[0]!, p.precio]));
    grupos = base.grupos.map((g) =>
      g.grupoId !== eje.grupoId
        ? g
        : {
            ...g,
            opciones: g.opciones.flatMap((o) => {
              if (o.esNinguna) return [o];
              const precio = porOpcion.get(o.opcionId);
              if (precio === null || precio === undefined) return [];
              return [g.tipo === "MEDIDA" ? { ...o, precioFinal: precio } : o];
            }),
          },
    );
  }
  return { ...base, grupos, desde, vendible: desde !== null, hayVariacion: base.hayVariacion || new Set(vendibles).size > 1 };
}
