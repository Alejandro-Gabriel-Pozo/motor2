import { aplicarDescuentoDeProducto } from "@/core/carta/public";
import { consumoDeLineaConfigurada, type ConsumoDeOpcionParaVender, type CodigoDeErrorDeConsumo, type OpcionConConsumo } from "@/core/movimientos/public";
import { huellaDeOpciones } from "@/core/opciones/public-servidor";
import { combinacionElegida, type CombinacionesDelProducto, type PrecioDeCombinacionVendible } from "./combinacion-elegida";
import {
  componerPrecioDeLinea,
  entradaConPrecioDeCombinacion,
  validarOpcionesElegidas,
  type CodigoDeErrorDeOpciones,
  type CodigoDeErrorDePrecio,
  type DiferenciaDePrecio,
  type GrupoPermitido,
  type ModoDePrecioDeMedida,
  type OpcionElegida,
  type OpcionParaPrecio,
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
  /** GO-3b: 1 o 2 si el grupo es un EJE de las combinaciones del producto (`ProductoAdmiteGrupo.ejeDeCombinacion`); ausente = no es eje (lo de siempre). */
  ejeDeCombinacion?: number;
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

/** GO-3b (ADR-032, frente A): las COMBINACIONES de un producto con ejes, para venderlo (definidas junto a `combinacionElegida`, que las usa también para mostrar). */
export type { CombinacionesDelProducto } from "./combinacion-elegida";

/** GO-3b: la FOTO de la combinación vendida (las columnas de `CombinacionEnLinea`, sin la línea) y las opciones de sus ejes (para la receta propia al cerrar). */
export interface FotoDeCombinacion {
  combinacionId: string;
  origenPrecio: "ADITIVO" | "PROPIO" | "GRUPO";
  precioDeSucursal: boolean;
  grupoDePrecioId: string | null;
  nombreGrupoDePrecio: string | null;
  /** El precio usado (PROPIO o GRUPO); `null` con ADITIVO. */
  precio: number | null;
  /** La versión VIGENTE de la receta propia al agregar el ítem (se congela: el cierre consume esa), o `null`. */
  recetaDeCombinacionVersionId: string | null;
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
  /** GO-3b: SOLO si la línea cae en una combinación que existe (una fila de `CombinacionDeProducto`): su foto. Ausente = sin combinación (lo de siempre). */
  combinacion?: FotoDeCombinacion;
}

export type CodigoDeLineaConfigurada = CodigoDeErrorDeOpciones | CodigoDeErrorDePrecio | CodigoDeErrorDeConsumo | "CONFIGURACION_INVALIDA" | "COMBINACION_NO_DISPONIBLE" | "PRECIO_DE_COMBINACION_INVALIDO";

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
  /**
   * GO-3b: las combinaciones del producto (OBLIGATORIAS si algún grupo es eje: sin ellas la línea falla cerrado, nunca se cobra el aditivo de una combinación que podría estar apagada). Sin ejes no
   * hace falta y la línea es exactamente la de siempre.
   */
  combinaciones?: CombinacionesDelProducto;
}

/** El precio de una opción por prioridad (ver el docstring del módulo), en la forma que pide `componerPrecioDeLinea`. */
function opcionParaPrecio(grupo: GrupoParaVender, opcion: OpcionParaVender, cantidad: number): OpcionParaPrecio {
  const base = { opcionId: opcion.opcionId, versionDeOpcionId: opcion.versionVigenteId, nombre: opcion.nombre, tipo: grupo.tipo, cantidad };
  if (grupo.tipo === "MEDIDA") {
    if (grupo.modoPrecio === "ABSOLUTO") {
      const precioDeSucursal = opcion.precioDeSucursal !== null;
      return { ...base, factorEscala: opcion.factorEscala, modoPrecio: "ABSOLUTO", precioAbsoluto: precioDeSucursal ? opcion.precioDeSucursal : opcion.precioAbsoluto, precioDeSucursal, diferencia: null };
    }
    return { ...base, factorEscala: opcion.factorEscala, modoPrecio: grupo.modoPrecio, precioAbsoluto: null, diferencia: opcion.diferenciaDelProducto ?? opcion.diferenciaDeLaVersion };
  }
  // «Ninguna» en VARIANTE o INCLUIDA: importe 0, sin diferencia. Un precio absoluto en algo que no es MEDIDA es una configuración inválida: se pasa para que la
  // composición lo rechace (`PRECIO_DE_OPCION_INVALIDO`), nunca se ignora en silencio. El factor de una versión que no es MEDIDA, ídem.
  return { ...base, factorEscala: opcion.factorEscala, modoPrecio: null, precioAbsoluto: opcion.precioAbsoluto, diferencia: opcion.esNinguna ? null : (opcion.diferenciaDelProducto ?? opcion.diferenciaDeLaVersion) };
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

  // GO-3b (ADR-032, frente A): si el producto tiene EJES, la combinación elegida decide (inactiva: no se vende; precio local, propio o de la tarifa: ese precio; sin fila o sin precio: el aditivo de
  // siempre). `componerPrecioDeLinea` no cambia: recibe la entrada transformada (`entradaConPrecioDeCombinacion`). Sin ejes, nada de esto corre.
  const combinada = combinacionDeLaLinea(entrada, queCuentan);
  if (!combinada.ok) return combinada;
  const entradaDePrecio = { precioBase, cantidad, opciones: queCuentan.map((e) => opcionParaPrecio(e.grupo, e.opcion, e.cantidad)) };
  const precio = componerPrecioDeLinea(combinada.precio === null ? entradaDePrecio : entradaConPrecioDeCombinacion(entradaDePrecio, combinada.precio, combinada.opcionesDeEjes));
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
      ...(combinada.foto !== null ? { combinacion: combinada.foto } : {}),
    },
  };
}

/** GO-3b: la combinación de la línea (`combinacionElegida`, compartida con los precios para mostrar) y su FOTO (solo si cae en una fila que existe). */
function combinacionDeLaLinea(
  entrada: EntradaLineaConfigurada,
  queCuentan: readonly { grupo: GrupoParaVender; opcion: OpcionParaVender }[],
): { ok: true; precio: PrecioDeCombinacionVendible | null; opcionesDeEjes: string[]; foto: FotoDeCombinacion | null } | { ok: false; codigo: CodigoDeLineaConfigurada; mensaje: string } {
  const elegida = combinacionElegida(entrada.grupos, queCuentan, entrada.combinaciones);
  if (!elegida.ok) return elegida;
  const { precio, opcionesDeEjes, fila } = elegida;
  if (precio === null || precio.origen === "SIN_COMBINACION" || fila === null) return { ok: true, precio, opcionesDeEjes, foto: null };
  const foto: FotoDeCombinacion =
    precio.origen === "ADITIVO"
      ? { combinacionId: fila.combinacionId, origenPrecio: "ADITIVO", precioDeSucursal: false, grupoDePrecioId: null, nombreGrupoDePrecio: null, precio: null, recetaDeCombinacionVersionId: fila.recetaDeCombinacionVersionId }
      : precio.origen === "PROPIO"
        ? { combinacionId: fila.combinacionId, origenPrecio: "PROPIO", precioDeSucursal: precio.precioDeSucursal, grupoDePrecioId: null, nombreGrupoDePrecio: null, precio: precio.precio, recetaDeCombinacionVersionId: fila.recetaDeCombinacionVersionId }
        : {
            combinacionId: fila.combinacionId,
            origenPrecio: "GRUPO",
            precioDeSucursal: precio.precioDeSucursal,
            grupoDePrecioId: precio.grupoDePrecioId,
            nombreGrupoDePrecio: precio.nombreGrupoDePrecio,
            precio: precio.precio,
            recetaDeCombinacionVersionId: fila.recetaDeCombinacionVersionId,
          };
  return { ok: true, precio, opcionesDeEjes, foto };
}
