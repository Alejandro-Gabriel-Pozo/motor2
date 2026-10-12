import { importeDeLinea, porcentajeDeImporte, redondearMoneda, totalDeLineas } from "@/core/moneda";
import {
  CANTIDAD_MAXIMA_DE_OPCION,
  FACTOR_DE_ESCALA_MAXIMO,
  IMPORTE_MINIMO,
  type DiferenciaDePrecio,
  type ModoDePrecioDeMedida,
  type TipoDeDiferencia,
  type TipoDeGrupoDeOpciones,
} from "./tipos";

/**
 * Composición EXACTA del precio de una línea con opciones (GO-0b; diseño §2.12, invariante I4). Función pura: dinero solo con `core/moneda.ts` (decimal.js, nunca
 * float), importes de 2 decimales y UN solo redondeo por cuenta.
 *
 * Precio de LISTA de la línea del producto (por unidad):
 * - MEDIDA en ABSOLUTO: el precio del producto en esa medida REEMPLAZA al base (en la sucursal con precio local ya viene resuelto por quien llama).
 * - MEDIDA en DIFERENCIA: base + la diferencia (monto fijo, o porcentaje del precio base redondeado al centavo, mitad hacia arriba, una sola vez).
 * - + la diferencia de cada VARIANTE elegida (monto o porcentaje del PRECIO BASE; sin diferencia declarada, 0). Supuesto: el porcentaje se calcula siempre sobre el
 *   precio base, no sobre el parcial con la medida: cada opción congela su propio importe y el resultado no depende del orden en que se eligieron.
 * - Las INCLUIDA suman 0 (su diferencia es 0 o ninguna; una distinta de 0 es una configuración inválida y se rechaza).
 * - Lista >= 0,01; si no, `PRECIO_DE_LISTA_INVALIDO`.
 *
 * El ADICIONAL no entra en el precio: es OTRA línea de venta, con su propio recargo (solo monto fijo, >= 0,01), con cantidad k × la del producto
 * y sin descuento de producto ni de cliente (eso lo garantiza quien arma la línea; acá solo se devuelve aparte).
 *
 * El detalle por opción (`DetalleDeOpcion`) es la FOTO de lo que cada opción aportó: el importe unitario ya redondeado, con el modo y el porcentaje usados. Es lo que se
 * guarda en `OpcionElegidaEnLinea` y lo que alimenta la huella (`huellaDeOpciones`, solo con las opciones DENTRO del precio).
 *
 * Qué NO hace: el descuento de producto (se aplica después, sobre la lista; supuesto S6), el descuento de cliente, las promos ni el IVA.
 */

/** Una opción elegida con los datos de precio YA resueltos por quien llama (la fila del producto manda sobre la de la versión; la grilla de la sucursal sobre el precio de toda la empresa). */
export interface OpcionParaPrecio {
  opcionId: string;
  versionDeOpcionId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  /** Unidades de la opción por unidad del producto (1 a 10). Del ADICIONAL es la `k` de «k × cantidad del producto». */
  cantidad: number;
  /** Solo MEDIDA. `null` = no escala el consumo (equivale a 1). */
  factorEscala: number | null;
  /** Solo MEDIDA: cómo se cobra. Las demás, `null`. */
  modoPrecio: ModoDePrecioDeMedida | null;
  /** Solo MEDIDA en ABSOLUTO: el precio del producto en esa medida. En DIFERENCIA se ignora (puede quedar de cuando estaba en ABSOLUTO). */
  precioAbsoluto: number | null;
  /** El importe salió de la grilla de la sucursal (`PrecioLocalDeOpcion`). */
  precioDeSucursal?: boolean;
  /** MEDIDA en DIFERENCIA, VARIANTE y ADICIONAL. En MEDIDA ABSOLUTO se ignora. `null` = sin diferencia (VARIANTE e INCLUIDA); el ADICIONAL la necesita. */
  diferencia: DiferenciaDePrecio | null;
}

export interface EntradaDePrecioDeLinea {
  /** El precio base del producto en la sucursal (`resolverPrecioVenta`: precio local vigente o global). */
  precioBase: number;
  /** Cantidad vendida del producto (entera, 1 o más: los productos con opciones se piden en cantidades enteras). */
  cantidad: number;
  opciones: readonly OpcionParaPrecio[];
}

/** Lo que una opción aportó, congelado. Mismos nombres que las columnas de `OpcionElegidaEnLinea`. */
export interface DetalleDeOpcion {
  opcionId: string;
  versionDeOpcionId: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidad: number;
  /** Lo que aportó por unidad: precio absoluto de la medida, diferencia, 0 (incluida) o recargo (adicional). */
  importeUnitario: number;
  /** Solo MEDIDA. */
  modoPrecio: ModoDePrecioDeMedida | null;
  /** En qué se expresó la diferencia usada (`null` si no hubo: precio absoluto, incluida o variante sin diferencia). */
  tipoDeDiferencia: TipoDeDiferencia | null;
  /** El porcentaje usado, solo si la diferencia fue un PORCENTAJE. */
  porcentaje: number | null;
  factorEscala: number | null;
  precioDeSucursal: boolean;
}

/** Un adicional: su propia línea de venta. */
export interface AdicionalComputado {
  opcionId: string;
  versionDeOpcionId: string;
  nombre: string;
  /** La `k`: unidades del adicional por unidad del producto. */
  cantidadPorUnidad: number;
  /** Cantidad de la línea del adicional: k × la cantidad del producto. */
  cantidad: number;
  recargoUnitario: number;
  /** `importeDeLinea(cantidad, recargoUnitario)`. */
  importe: number;
  detalle: DetalleDeOpcion;
}

export interface PrecioComponido {
  /** Precio de lista por unidad de la línea del producto (medida + variantes + incluidas dentro del precio). */
  precioDeLista: number;
  /** `importeDeLinea(cantidad, precioDeLista)`. */
  importeDelProducto: number;
  /** MEDIDA, VARIANTE e INCLUIDA, en el orden recibido. */
  dentroDelPrecio: DetalleDeOpcion[];
  /** Los ADICIONALES, en el orden recibido, cada uno con su línea. */
  adicionales: AdicionalComputado[];
  /** Producto + adicionales: suma exacta y un solo redondeo. */
  total: number;
}

export const CODIGOS_DE_ERROR_DE_PRECIO = [
  "PRECIO_BASE_INVALIDO",
  "CANTIDAD_INVALIDA",
  "OPCION_REPETIDA",
  "MEDIDAS_MULTIPLES",
  "PRECIO_DE_OPCION_INVALIDO",
  "RECARGO_INVALIDO",
  "FACTOR_DE_ESCALA_INVALIDO",
  "PRECIO_DE_LISTA_INVALIDO",
] as const;
export type CodigoDeErrorDePrecio = (typeof CODIGOS_DE_ERROR_DE_PRECIO)[number];

export interface FallaDePrecio {
  ok: false;
  codigo: CodigoDeErrorDePrecio;
  mensaje: string;
  opcionId?: string;
}
export type ResultadoDePrecio = { ok: true; precio: PrecioComponido } | FallaDePrecio;

/** Tope de un importe: `DECIMAL(14,2)` guarda 12 dígitos enteros. */
const LIMITE_DE_IMPORTE = 1e12;

function falla(codigo: CodigoDeErrorDePrecio, mensaje: string, opcionId?: string): FallaDePrecio {
  return { ok: false, codigo, mensaje, ...(opcionId === undefined ? {} : { opcionId }) };
}

/** Un importe de `DECIMAL(14,2)`: finito, con a lo sumo 2 decimales. */
function esImporte(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) < LIMITE_DE_IMPORTE && redondearMoneda(n) === n;
}

/** Un porcentaje de `DECIMAL(7,4)`: finito, con a lo sumo 4 decimales, mayor que -100 y hasta 999,9999. */
function esPorcentaje(p: number): boolean {
  return Number.isFinite(p) && p > -100 && p <= 999.9999 && Number(p.toFixed(4)) === p;
}

function esDiferenciaValida(d: DiferenciaDePrecio): boolean {
  return d.tipo === "MONTO" ? esImporte(d.monto) : esPorcentaje(d.porcentaje);
}

/** Lo que aporta una diferencia por unidad: el monto tal cual, o el porcentaje del precio base redondeado al centavo (una sola vez). */
function importeDeDiferencia(d: DiferenciaDePrecio, precioBase: number): number {
  return d.tipo === "MONTO" ? redondearMoneda(d.monto) : porcentajeDeImporte(precioBase, d.porcentaje);
}

function detalleBase(op: OpcionParaPrecio, importeUnitario: number, diferencia: DiferenciaDePrecio | null): DetalleDeOpcion {
  return {
    opcionId: op.opcionId,
    versionDeOpcionId: op.versionDeOpcionId,
    tipo: op.tipo,
    cantidad: op.cantidad,
    importeUnitario,
    modoPrecio: op.modoPrecio, // ya validado: solo la MEDIDA lo lleva
    tipoDeDiferencia: diferencia === null ? null : diferencia.tipo,
    porcentaje: diferencia !== null && diferencia.tipo === "PORCENTAJE" ? diferencia.porcentaje : null,
    factorEscala: op.factorEscala,
    precioDeSucursal: op.precioDeSucursal ?? false,
  };
}

type Detalle = { ok: true; detalle: DetalleDeOpcion } | FallaDePrecio;

/** El importe unitario de UNA opción y su foto; o el motivo por el que su configuración no sirve. */
function detalleDeOpcion(op: OpcionParaPrecio, precioBase: number): Detalle {
  const mal = (codigo: CodigoDeErrorDePrecio, mensaje: string): FallaDePrecio => falla(codigo, mensaje, op.opcionId);

  if (op.factorEscala !== null) {
    if (op.tipo !== "MEDIDA") return mal("FACTOR_DE_ESCALA_INVALIDO", `«${op.nombre}» no es un tamaño, así que no puede tener factor de escala.`);
    if (!Number.isFinite(op.factorEscala) || op.factorEscala <= 0 || op.factorEscala > FACTOR_DE_ESCALA_MAXIMO || Number(op.factorEscala.toFixed(4)) !== op.factorEscala) {
      return mal("FACTOR_DE_ESCALA_INVALIDO", `El factor de escala de «${op.nombre}» tiene que ser mayor que 0 y hasta ${FACTOR_DE_ESCALA_MAXIMO}, con hasta 4 decimales.`);
    }
  }
  if (op.tipo !== "MEDIDA" && (op.modoPrecio !== null || op.precioAbsoluto !== null)) {
    return mal("PRECIO_DE_OPCION_INVALIDO", `«${op.nombre}» no es un tamaño, así que no puede tener un modo de precio ni un precio absoluto.`);
  }

  if (op.tipo === "MEDIDA") {
    if (op.modoPrecio === "ABSOLUTO") {
      const precio = op.precioAbsoluto;
      if (precio === null || !esImporte(precio) || precio < IMPORTE_MINIMO) {
        return mal("PRECIO_DE_OPCION_INVALIDO", `«${op.nombre}» no tiene un precio válido para este producto: tiene que ser de 0,01 o más.`);
      }
      return { ok: true, detalle: detalleBase(op, redondearMoneda(precio), null) };
    }
    if (op.modoPrecio === "DIFERENCIA") {
      if (op.diferencia === null || !esDiferenciaValida(op.diferencia)) {
        return mal("PRECIO_DE_OPCION_INVALIDO", `«${op.nombre}» no tiene una diferencia de precio válida para este producto.`);
      }
      return { ok: true, detalle: detalleBase(op, importeDeDiferencia(op.diferencia, precioBase), op.diferencia) };
    }
    return mal("PRECIO_DE_OPCION_INVALIDO", `«${op.nombre}» no tiene definido cómo se cobra: precio propio o diferencia.`);
  }

  if (op.tipo === "VARIANTE") {
    if (op.diferencia === null) return { ok: true, detalle: detalleBase(op, 0, null) };
    if (!esDiferenciaValida(op.diferencia)) return mal("PRECIO_DE_OPCION_INVALIDO", `«${op.nombre}» no tiene una diferencia de precio válida.`);
    return { ok: true, detalle: detalleBase(op, importeDeDiferencia(op.diferencia, precioBase), op.diferencia) };
  }

  if (op.tipo === "INCLUIDA") {
    const aporta = op.diferencia === null ? 0 : op.diferencia.tipo === "MONTO" ? op.diferencia.monto : op.diferencia.porcentaje;
    if (aporta !== 0) return mal("PRECIO_DE_OPCION_INVALIDO", `«${op.nombre}» viene incluida en el precio: no puede tener diferencia de precio.`);
    return { ok: true, detalle: detalleBase(op, 0, null) };
  }

  // ADICIONAL: solo monto fijo, de 0,01 o más.
  if (op.diferencia === null || op.diferencia.tipo !== "MONTO" || !esImporte(op.diferencia.monto) || op.diferencia.monto < IMPORTE_MINIMO) {
    return mal("RECARGO_INVALIDO", `«${op.nombre}» es un adicional: su recargo tiene que ser un monto fijo de 0,01 o más.`);
  }
  return { ok: true, detalle: detalleBase(op, redondearMoneda(op.diferencia.monto), op.diferencia) };
}

export function componerPrecioDeLinea(entrada: EntradaDePrecioDeLinea): ResultadoDePrecio {
  const { precioBase, cantidad, opciones } = entrada;
  if (!Number.isFinite(precioBase) || precioBase < 0) return falla("PRECIO_BASE_INVALIDO", "El precio del producto no es válido.");
  if (!Number.isInteger(cantidad) || cantidad < 1) return falla("CANTIDAD_INVALIDA", "Un producto con opciones se pide en cantidades enteras, de 1 en adelante.");

  const vistas = new Set<string>();
  for (const op of opciones) {
    if (!Number.isInteger(op.cantidad) || op.cantidad < 1 || op.cantidad > CANTIDAD_MAXIMA_DE_OPCION) {
      return falla("CANTIDAD_INVALIDA", `La cantidad de «${op.nombre}» tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`, op.opcionId);
    }
    if (op.tipo === "MEDIDA" && op.cantidad !== 1) return falla("CANTIDAD_INVALIDA", `«${op.nombre}» es un tamaño: se elige una sola vez.`, op.opcionId);
    if (vistas.has(op.opcionId)) return falla("OPCION_REPETIDA", `La opción «${op.nombre}» está repetida: usá la cantidad en vez de cargarla dos veces.`, op.opcionId);
    vistas.add(op.opcionId);
  }
  if (opciones.filter((o) => o.tipo === "MEDIDA").length > 1) return falla("MEDIDAS_MULTIPLES", "Un producto admite una sola medida por línea.");

  const dentroDelPrecio: DetalleDeOpcion[] = [];
  const adicionales: AdicionalComputado[] = [];
  for (const op of opciones) {
    const resuelto = detalleDeOpcion(op, precioBase);
    if (!resuelto.ok) return resuelto;
    if (op.tipo !== "ADICIONAL") {
      dentroDelPrecio.push(resuelto.detalle);
      continue;
    }
    const cantidadDeLaLinea = cantidad * op.cantidad;
    adicionales.push({
      opcionId: op.opcionId,
      versionDeOpcionId: op.versionDeOpcionId,
      nombre: op.nombre,
      cantidadPorUnidad: op.cantidad,
      cantidad: cantidadDeLaLinea,
      recargoUnitario: resuelto.detalle.importeUnitario,
      importe: importeDeLinea(cantidadDeLaLinea, resuelto.detalle.importeUnitario),
      detalle: resuelto.detalle,
    });
  }

  const medidaAbsoluta = dentroDelPrecio.some((d) => d.modoPrecio === "ABSOLUTO"); // solo la MEDIDA lleva modo de precio
  const partes = [...(medidaAbsoluta ? [] : [{ cantidad: 1, precioUnitario: precioBase }]), ...dentroDelPrecio.map((d) => ({ cantidad: d.cantidad, precioUnitario: d.importeUnitario }))];
  const precioDeLista = totalDeLineas(partes);
  if (precioDeLista < IMPORTE_MINIMO) return falla("PRECIO_DE_LISTA_INVALIDO", "Con las opciones elegidas el precio queda en menos de 0,01: revisá las diferencias de precio.");

  return {
    ok: true,
    precio: {
      precioDeLista,
      importeDelProducto: importeDeLinea(cantidad, precioDeLista),
      dentroDelPrecio,
      adicionales,
      total: totalDeLineas([{ cantidad, precioUnitario: precioDeLista }, ...adicionales.map((a) => ({ cantidad: a.cantidad, precioUnitario: a.recargoUnitario }))]),
    },
  };
}
