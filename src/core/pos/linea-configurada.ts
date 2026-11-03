import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import { consumoDeLineaConfigurada, type ConsumoDeOpcionParaVender, type CodigoDeErrorDeConsumo, type OpcionConConsumo } from "@/core/movimientos/public";
import { huellaDeOpciones } from "@/core/opciones/public-servidor";
import { opcionParaPrecio } from "./opcion-para-precio";
import {
  componerPrecioDeLinea,
  validarOpcionesElegidas,
  type CodigoDeErrorDeOpciones,
  type CodigoDeErrorDePrecio,
  type DiferenciaDePrecio,
  type GrupoPermitido,
  type ModoDePrecioDeMedida,
  type OpcionElegida,
  type OpcionPermitida,
  type TipoDeDiferencia,
  type TipoDeGrupoDeOpciones,
} from "@/core/opciones/public";

/**
 * Armar la LÍNEA CONFIGURADA de un producto al agregarlo a una cuenta (GO-2b, ADR-030). Función pura: encadena las piezas de GO-0b en el orden de la venta,
 * con lo que el caso de uso ya leyó (los grupos y opciones que el producto admite en la sucursal, el precio base y el % de descuento de producto):
 *
 *  1. `validarOpcionesElegidas`: lo elegido contra lo que el producto permite (apagados, topes, mínimos y máximos, la versión que vio el mozo);
 *  2. el precio de cada opción por PRIORIDAD: la diferencia del producto (`ProductoAdmiteOpcion`) le gana a la de la versión; en una MEDIDA en ABSOLUTO, la grilla
 *     de la sucursal (`PrecioLocalDeOpcion`, ya filtrada por quien llama: habilitada, con `precio_local` prendida y con el producto admitiendo la opción) le gana al
 *     precio absoluto del producto. `modoPrecio` NULL en una MEDIDA hace fallar la venta (`PRECIO_DE_OPCION_INVALIDO`);
 *  3. `componerPrecioDeLinea` (lista exacta, un redondeo por cuenta) y `aplicarDescuentoDeProducto` SOBRE LA LISTA COMPUESTA (el adicional nunca lleva descuento);
 *  4. `huellaDeOpciones` con lo que va DENTRO del precio (un padre que solo lleva adicionales queda sin huella);
 *  5. `consumoDeLineaConfigurada` con `base: []`: detecta ya al pedir lo que no depende de la receta (`OPCIONES_INCOMPATIBLES`, `CONSUMO_INVALIDO`).
 *
 * La opción «ninguna»: en INCLUIDA o VARIANTE va a la foto con importe 0 y sin consumo; en ADICIONAL cuenta para el mínimo pero no genera línea ni foto (no tiene
 * producto ancla); en MEDIDA es una configuración inválida (`CONFIGURACION_INVALIDA`). Un adicional que no es «ninguna» sin producto ancla, también.
 *
 * Devuelve `linea: null` cuando no quedó ninguna opción (nada elegido y nada obligatorio, o solo «ninguna» de adicionales): el producto se pide como siempre, sin
 * opciones. Cantidades enteras (las exige `componerPrecioDeLinea`).
 */

/** Una opción que el producto admite, tal como se lee para venderla: lo que pide la validación más su precio y su consumo (de la versión VIGENTE). */
export interface OpcionParaVender extends OpcionPermitida {
  /** `OpcionDeGrupo.orden`. */
  orden: number;
  /** `OpcionDeGrupo.productoId`: el producto ANCLA de un adicional (`null` en las demás y en «ninguna»). */
  productoAnclaId: string | null;
  /** La diferencia de la versión vigente (`VersionDeOpcion`: siempre tiene una, MONTO o PORCENTAJE). */
  diferenciaDeLaVersion: DiferenciaDePrecio;
  /** `VersionDeOpcion.factorEscala` de la vigente. */
  factorEscala: number | null;
  /** `ConsumoDeOpcion` de la versión vigente, en su orden. */
  consumos: readonly ConsumoDeOpcionParaVender[];
  /** `ProductoAdmiteOpcion.precioAbsoluto`: el precio del producto en esta medida (solo MEDIDA en ABSOLUTO). */
  precioAbsoluto: number | null;
  /** `ProductoAdmiteOpcion`: la diferencia del producto, si la sobrescribe (le gana a la de la versión). */
  diferenciaDelProducto: DiferenciaDePrecio | null;
  /** La grilla de la sucursal (`PrecioLocalDeOpcion` vigente) para esta opción en este producto, o `null`. */
  precioDeSucursal: number | null;
}

/** Un grupo que el producto admite, con su orden y el modo de precio de la medida (`ProductoAdmiteGrupo`). */
export interface GrupoParaVender extends Omit<GrupoPermitido, "opciones"> {
  orden: number;
  modoPrecio: ModoDePrecioDeMedida | null;
  opciones: readonly OpcionParaVender[];
}

/** La FOTO de una opción elegida: las columnas de `OpcionElegidaEnLinea`, tal cual se escriben. */
export interface FotoDeOpcion {
  grupoId: string;
  opcionId: string;
  versionDeOpcionId: string;
  tipoGrupo: TipoDeGrupoDeOpciones;
  nombreGrupo: string;
  nombreOpcion: string;
  cantidad: number;
  modoPrecio: ModoDePrecioDeMedida | null;
  tipoDeDiferencia: TipoDeDiferencia | null;
  porcentaje: number | null;
  importeUnitario: number;
  precioDeSucursal: boolean;
  factorEscala: number | null;
  /** El lugar en la lista de permitidos (grupo, opción): con él se rearma el orden del consumo al cerrar. */
  orden: number;
}

/** La línea de un adicional: su producto ancla, k × la cantidad del producto, su recargo (sin descuento) y su foto. */
export interface AdicionalArmado {
  opcionId: string;
  productoId: string;
  /** La `k`: unidades del adicional por unidad del producto. */
  cantidadPorUnidad: number;
  cantidad: number;
  precioUnitario: number;
  foto: FotoDeOpcion;
}

export interface LineaConfigurada {
  /** Precio por unidad de la línea del producto: la lista compuesta, con el descuento de producto ya aplicado si rige. */
  precioUnitario: number;
  /** La lista compuesta, SOLO si el descuento de producto cambió el precio (va a `CuentaItem.precioCartaUnitario`); `null` si no. */
  precioCartaUnitario: number | null;
  /** La huella de lo que va dentro del precio, o `null` si la línea solo lleva adicionales. */
  huellaOpciones: string | null;
  /** Las fotos de la línea del producto (MEDIDA, VARIANTE e INCLUIDA). */
  fotos: FotoDeOpcion[];
  adicionales: AdicionalArmado[];
  /**
   * Cuántos insumos pide lo elegido DENTRO del precio sin contar la receta de la base (el consumo de las opciones con la base vacía: una SUMA por insumo; un REEMPLAZA sin nada que reemplazar
   * no cuenta). Con la base sin receta, la línea se pide solo si es mayor que 0 (ventas con opciones, 2026-10-29): es el aviso temprano de lo que el cobro vuelve a decidir con los pedidos reales.
   */
  insumosSinLaBase: number;
}

export type CodigoDeLineaConfigurada = CodigoDeErrorDeOpciones | CodigoDeErrorDePrecio | CodigoDeErrorDeConsumo | "CONFIGURACION_INVALIDA";

export type ResultadoLineaConfigurada = { ok: true; linea: LineaConfigurada | null } | { ok: false; codigo: CodigoDeLineaConfigurada; mensaje: string };

export interface EntradaLineaConfigurada {
  /** Lo que el producto admite (vacío = no admite nada). */
  grupos: readonly GrupoParaVender[];
  elegidas: readonly OpcionElegida[];
  /** `resolverPrecioVenta` del producto en la sucursal, ya redondeado. */
  precioBase: number;
  /** El % de descuento de producto que rige en la sucursal (`null` = ninguno). */
  descuentoDeProducto: number | null;
  cantidad: number;
}

export function armarLineaConfigurada(entrada: EntradaLineaConfigurada): ResultadoLineaConfigurada {
  const { grupos, elegidas, precioBase, descuentoDeProducto, cantidad } = entrada;
  const validacion = validarOpcionesElegidas(grupos, elegidas);
  if (!validacion.ok) return { ok: false, codigo: validacion.codigo, mensaje: validacion.mensaje };

  // Las validadas salen en el orden de la lista de permitidos (grupo y opción): ese lugar es el `orden` de la foto.
  const elegidasParaVender = validacion.opciones.map((v, orden) => {
    const grupo = grupos.find((g) => g.grupoId === v.grupoId)!;
    const opcion = grupo.opciones.find((o) => o.opcionId === v.opcionId)!;
    return { grupo, opcion, cantidad: v.cantidad, orden };
  });

  for (const { grupo, opcion } of elegidasParaVender) {
    if (opcion.esNinguna && grupo.tipo === "MEDIDA") return { ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: `«${opcion.nombre}» no puede ser una medida: un tamaño siempre tiene un precio.` };
    if (!opcion.esNinguna && grupo.tipo === "ADICIONAL" && opcion.productoAnclaId === null) {
      return { ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: `«${opcion.nombre}» es un adicional sin producto que lo respalde: no se puede vender.` };
    }
  }
  // La «ninguna» de un adicional ya contó para el mínimo: no genera línea ni foto.
  const queCuentan = elegidasParaVender.filter((e) => !(e.opcion.esNinguna && e.grupo.tipo === "ADICIONAL"));
  if (queCuentan.length === 0) return { ok: true, linea: null };

  const precio = componerPrecioDeLinea({ precioBase, cantidad, opciones: queCuentan.map((e) => opcionParaPrecio(e.grupo, e.opcion, e.cantidad)) });
  if (!precio.ok) return { ok: false, codigo: precio.codigo, mensaje: precio.mensaje };

  const consumo = consumoDeLineaConfigurada({
    cantidad,
    sucursalId: "",
    base: [],
    opciones: queCuentan
      .filter((e) => e.grupo.tipo !== "ADICIONAL")
      .map((e): OpcionConConsumo => ({
        opcionId: e.opcion.opcionId,
        nombre: e.opcion.nombre,
        tipo: e.grupo.tipo as OpcionConConsumo["tipo"],
        ordenDeGrupo: e.orden,
        ordenDeOpcion: 0,
        cantidad: e.cantidad,
        factorEscala: e.grupo.tipo === "MEDIDA" ? e.opcion.factorEscala : null,
        consumos: e.opcion.esNinguna ? [] : e.opcion.consumos,
      })),
    adicionales: queCuentan.filter((e) => e.grupo.tipo === "ADICIONAL").map((e) => ({ opcionId: e.opcion.opcionId, nombre: e.opcion.nombre, cantidadPorUnidad: e.cantidad, consumos: e.opcion.consumos })),
  });
  if (!consumo.ok) return { ok: false, codigo: consumo.codigo, mensaje: consumo.mensaje };

  const fotoDe = (e: (typeof queCuentan)[number], detalle: (typeof precio.precio.dentroDelPrecio)[number]): FotoDeOpcion => ({
    grupoId: e.grupo.grupoId,
    opcionId: e.opcion.opcionId,
    versionDeOpcionId: e.opcion.versionVigenteId,
    tipoGrupo: e.grupo.tipo,
    nombreGrupo: e.grupo.nombre,
    nombreOpcion: e.opcion.nombre,
    cantidad: e.cantidad,
    modoPrecio: detalle.modoPrecio,
    tipoDeDiferencia: detalle.tipoDeDiferencia,
    porcentaje: detalle.porcentaje,
    importeUnitario: detalle.importeUnitario,
    precioDeSucursal: detalle.precioDeSucursal,
    factorEscala: detalle.factorEscala,
    orden: e.orden,
  });
  const porOpcion = new Map(queCuentan.map((e) => [e.opcion.opcionId, e]));
  const fotos = precio.precio.dentroDelPrecio.map((d) => fotoDe(porOpcion.get(d.opcionId)!, d));
  const adicionales = precio.precio.adicionales.map((a): AdicionalArmado => {
    const e = porOpcion.get(a.opcionId)!;
    return { opcionId: a.opcionId, productoId: e.opcion.productoAnclaId!, cantidadPorUnidad: a.cantidadPorUnidad, cantidad: a.cantidad, precioUnitario: a.recargoUnitario, foto: fotoDe(e, a.detalle) };
  });

  const aplicado = aplicarDescuentoDeProducto(precio.precio.precioDeLista, descuentoDeProducto);
  return {
    ok: true,
    linea: {
      precioUnitario: aplicado.precio,
      precioCartaUnitario: aplicado.precioLista,
      huellaOpciones: huellaDeOpciones(fotos.map((f) => ({ opcionId: f.opcionId, versionDeOpcionId: f.versionDeOpcionId, cantidad: f.cantidad, importeUnitario: f.importeUnitario, factorEscala: f.factorEscala }))),
      fotos,
      adicionales,
      insumosSinLaBase: consumo.pedidos.length,
    },
  };
}
