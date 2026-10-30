import { esNumeroFinito } from "@/core/numero";
import { texto, LARGO_MAXIMO_MOTIVO_ANULACION } from "@/core/texto";
import { precioCobradoConDescuentos } from "@/core/carta/public";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { esBaseConfigurable, nombreDeLineaConfigurada, type FotoParaElNombre } from "@/core/opciones/public";
import { nombreDelMesero, tiempoDesde } from "./mesas";
import { validarCantidadPedido } from "./cantidad-pedido";
import { claveDeLineaDeVenta } from "./clave-de-linea";
import { claveDeLineaDeVentaConOpciones } from "./clave-de-linea-con-opciones";

// Re-exportada: quien ya la importaba de acá (test/pos/cuenta.test.ts, esta misma Server Action) sigue andando igual. Vive en
// `cantidad-pedido.ts` por historia: la lectura de la mesa vivía en este archivo y un cliente no podía importarlo.
export { validarCantidadPedido };

/**
 * Cuenta de una mesa: núcleo puro y de consulta de «tomar pedido» (módulo POS, docs/plan-tomar-pedido-2026-09-25.md, paso 2).
 * Sin permisos ni escrituras: las Server Actions (src/server/actions/pos/cuenta.ts) y la pantalla de detalle
 * (src/app/(pos)/mesas/[mesaId]/page.tsx) lo usan después de su propia guarda.
 *
 * Dos reglas del modelo (comentario del bloque POS en prisma/schema.prisma):
 * - KOT derivado: un ítem con `numeroEnvio` null está SIN ENVIAR; con 1..n, salió en ese envío a cocina.
 * - Anulación = fila ESPEJO: un CuentaItem con cantidad negativa y `anulaAItemId` al original, que nunca se toca. Lo que queda de un
 *   ítem es `cantidad + Σ espejos` — se calcula, no se guarda.
 */

/** Cantidades de la columna `Decimal(14, 4)`: la suma en coma flotante no deja «1,9999999». */
function redondearCantidad(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Cuánto queda vigente de un ítem original después de sus anulaciones (espejos con cantidad negativa). */
export function restanteDe(item: { cantidad: number }, espejos: readonly { cantidad: number }[]): number {
  return redondearCantidad(espejos.reduce((suma, e) => suma + e.cantidad, item.cantidad));
}

export interface LineaDeVenta {
  productoId: string;
  precioUnitario: number;
  cantidad: number;
  /** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 3): la `PromoCuenta` de la que este componente forma
   *  parte — SOLO presente cuando el ítem que lo originó tenía uno. Ausente = un suelto de siempre, salida IDÉNTICA a antes
   *  de esta Task. Suma a la CLAVE de agrupación (ver abajo) para que un suelto y un componente de promo del MISMO producto
   *  al MISMO precio nunca se mezclen en una sola línea/Operacion (`cerrarCuenta`, paso 8c). */
  promoCuentaId?: string;
  /** Producto con descuento (Fase 2 de «promociones, un solo concepto»): el precio de lista que tenía el ítem ANTES del descuento del producto
   *  (`CuentaItem.precioCartaUnitario`) — SOLO en un suelto que tuvo descuento de producto. Nunca en un componente de promo (su
   *  `precioCartaUnitario` es otra cosa: el precio de carta para repartir la promo). Ausente = igual que siempre. */
  precioCartaUnitario?: number;
  /** GO-2b (ADR-030): la huella de las opciones que van dentro del precio — SOLO en una línea configurada. Ausente = sin opciones, como siempre. */
  huellaOpciones?: string;
  /** GO-2b: SOLO en un ADICIONAL: el índice, en esta misma salida, de la línea de su padre (que siempre va antes). */
  indicePadre?: number;
  /** GO-2b: SOLO en una línea configurada o en un adicional (y si los ítems traían `id`): los ítems (originales y espejos) que la forman, para enlazarlos
   *  con su Operacion por id. Las demás líneas se enlazan por su clave, como siempre. */
  itemIds?: string[];
}

// Re-exportada: vive en `clave-de-linea.ts` desde GO-2b (para que `clave-de-linea-con-opciones.ts` no importe este archivo, que la usa); quien la importaba
// de acá sigue igual.
export { claveDeLineaDeVenta };

/** Un ítem de la cuenta para `lineasDeVenta`. `id`, `huellaOpciones` y `lineaPadreId` (GO-2b) son opcionales: sin ellos, todo como siempre. */
export interface ItemParaLineaDeVenta {
  id?: string;
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  promoCuentaId?: string | null;
  precioCartaUnitario?: number | null;
  /** GO-2b: la huella de las opciones dentro del precio (`CuentaItem.huellaOpciones`); un espejo repite la de su original. */
  huellaOpciones?: string | null;
  /** GO-2b: la línea padre de un adicional (`CuentaItem.lineaPadreId`); un espejo repite la de su original. */
  lineaPadreId?: string | null;
  /** GO-2b: el original de un espejo (`CuentaItem.anulaAItemId`): de él hereda la versión de su adicional. */
  anulaAItemId?: string | null;
  /** GO-2b: SOLO en un adicional original, la versión de su opción (la de su foto): dos adicionales al mismo precio pero de versiones distintas consumen distinto y
   *  no se juntan en una línea. Un espejo la toma de su original. */
  versionDeAdicional?: string | null;
}

/**
 * Líneas NETAS para registrar la venta de una cuenta: suma originales y espejos por (producto, precio congelado, promo) — el
 * mismo producto cargado a dos precios distintos (cambió el Precio Local entre una ronda y otra) queda en dos líneas, cada una
 * a su precio; el mismo producto al MISMO precio pero uno suelto y otro como componente de una promo (o de dos promos
 * distintas) también queda en líneas separadas (Task #16, D4: una promo se anula ENTERA, nunca mezclada con un suelto en la
 * misma Operacion). Una línea neta ≤ 0 (anulada entera) se descarta: no se vende. Orden: el de la primera aparición de cada
 * línea. Sin ningún `promoCuentaId` en la entrada, la salida es EXACTAMENTE la de antes de esta Task (mismo criterio aditivo
 * que el resto del plan).
 *
 * GO-2b (ADR-030), también ADITIVO: la clave es la de `claveDeLineaDeVentaConOpciones`. Una línea configurada suma su huella (dos cafés con distinta
 * configuración son dos líneas; con la misma, una sola). Un ADICIONAL se agrupa por su producto ancla, su precio y la clave de la línea de su PADRE, y va justo
 * DESPUÉS de esa línea (con `indicePadre`); si trae la versión de su opción (`versionDeAdicional`), dos versiones distintas al mismo precio son dos líneas (consumen
 * distinto). Un padre que solo tiene adicionales no tiene huella: se junta con los del mismo producto sin opciones (y su adicional
 * cuelga de esa línea). Un adicional cuyo padre no está en la cuenta, o que todavía tiene algo para cobrar cuando su padre quedó en 0, es una incoherencia: se
 * LANZA un error (no se cobra a ciegas). Sin huella ni padre en la entrada, la salida es exactamente la de antes (lo fija una propiedad de fast-check).
 */
export function lineasDeVenta(items: readonly ItemParaLineaDeVenta[]): LineaDeVenta[] {
  const porId = new Map<string, ItemParaLineaDeVenta>();
  for (const item of items) if (item.id !== undefined) porId.set(item.id, item);

  const camposDeClave = (item: ItemParaLineaDeVenta) => {
    const promoCuentaId = item.promoCuentaId ?? undefined;
    const precioCartaUnitario = !promoCuentaId && item.precioCartaUnitario != null ? item.precioCartaUnitario : undefined;
    return { productoId: item.productoId, precioUnitario: item.precioUnitario, promoCuentaId, precioCartaUnitario };
  };
  // La clave de una línea que no es un adicional.
  const claveDeProducto = (item: ItemParaLineaDeVenta): string => claveDeLineaDeVentaConOpciones({ ...camposDeClave(item), huellaOpciones: item.huellaOpciones ?? null });
  const claveDe = (item: ItemParaLineaDeVenta): { clave: string; clavePadre: string | null } => {
    const lineaPadreId = item.lineaPadreId ?? null;
    if (lineaPadreId === null) return { clave: claveDeProducto(item), clavePadre: null };
    const padre = porId.get(lineaPadreId);
    if (!padre) throw new Error("lineasDeVenta: un adicional cuya línea padre no está en la cuenta.");
    if ((padre.lineaPadreId ?? null) !== null) throw new Error("lineasDeVenta: la línea padre de un adicional no puede ser otro adicional.");
    const clavePadre = claveDeProducto(padre);
    const original = item.anulaAItemId ? porId.get(item.anulaAItemId) : undefined;
    const version = item.versionDeAdicional ?? original?.versionDeAdicional ?? null;
    return { clave: claveDeLineaDeVentaConOpciones({ ...camposDeClave(item), clavePadre: version === null ? clavePadre : `${clavePadre}|v:${version}` }), clavePadre };
  };

  const porClave = new Map<string, { linea: LineaDeVenta; clavePadre: string | null }>();
  for (const item of items) {
    const { clave, clavePadre } = claveDe(item);
    const conIds = (item.huellaOpciones ?? null) !== null || clavePadre !== null;
    const previa = porClave.get(clave);
    if (previa) {
      previa.linea.cantidad = redondearCantidad(previa.linea.cantidad + item.cantidad);
      if (conIds && item.id !== undefined) previa.linea.itemIds = [...(previa.linea.itemIds ?? []), item.id];
      continue;
    }
    const { promoCuentaId, precioCartaUnitario } = camposDeClave(item);
    const huellaOpciones = item.huellaOpciones ?? null;
    porClave.set(clave, {
      clavePadre,
      linea: {
        productoId: item.productoId,
        precioUnitario: item.precioUnitario,
        cantidad: redondearCantidad(item.cantidad),
        ...(promoCuentaId ? { promoCuentaId } : {}),
        ...(precioCartaUnitario !== undefined ? { precioCartaUnitario } : {}),
        ...(huellaOpciones !== null ? { huellaOpciones } : {}),
        ...(conIds && item.id !== undefined ? { itemIds: [item.id] } : {}),
      },
    });
  }

  const adicionalesDe = new Map<string, LineaDeVenta[]>();
  for (const { linea, clavePadre } of porClave.values()) {
    if (clavePadre !== null) adicionalesDe.set(clavePadre, [...(adicionalesDe.get(clavePadre) ?? []), linea]);
  }
  const salida: LineaDeVenta[] = [];
  for (const [clave, { linea, clavePadre }] of porClave) {
    if (clavePadre !== null) continue;
    const adicionales = adicionalesDe.get(clave) ?? [];
    if (linea.cantidad <= 0) {
      if (adicionales.some((a) => a.cantidad > 0)) throw new Error("lineasDeVenta: un adicional con algo para cobrar cuya línea padre quedó anulada entera.");
      continue;
    }
    const indicePadre = salida.length;
    salida.push(linea);
    for (const adicional of adicionales) if (adicional.cantidad > 0) salida.push({ ...adicional, indicePadre });
  }
  return salida;
}

export interface ItemAgrupable {
  id: string;
  cantidad: number;
  numeroEnvio: number | null;
  anulaAItemId: string | null;
}

export type ItemEnEnvio<T> = T & { restante: number; anulaciones: T[] };

export interface ItemsAgrupados<T> {
  /** Ítems todavía sin enviar a cocina (borradores), en el orden recibido. */
  sinEnviar: T[];
  /** Envíos a cocina en orden (1, 2, …): cada ítem original con lo que le queda y sus anulaciones colgadas. */
  envios: { numero: number; items: ItemEnEnvio<T>[] }[];
}

/**
 * «Sin enviar» + un grupo por envío a cocina. Las filas espejo no aparecen sueltas: cuelgan de su ítem original (`anulaciones`),
 * que lleva además su `restante`. Respeta el orden recibido dentro de cada grupo.
 */
export function agruparPorEnvio<T extends ItemAgrupable>(items: readonly T[]): ItemsAgrupados<T> {
  const espejosDe = new Map<string, T[]>();
  for (const item of items) {
    if (item.anulaAItemId === null) continue;
    espejosDe.set(item.anulaAItemId, [...(espejosDe.get(item.anulaAItemId) ?? []), item]);
  }

  const sinEnviar: T[] = [];
  const porEnvio = new Map<number, ItemEnEnvio<T>[]>();
  for (const item of items) {
    if (item.anulaAItemId !== null) continue;
    if (item.numeroEnvio === null) {
      sinEnviar.push(item);
      continue;
    }
    const anulaciones = espejosDe.get(item.id) ?? [];
    const grupo = porEnvio.get(item.numeroEnvio) ?? [];
    grupo.push({ ...item, restante: restanteDe(item, anulaciones), anulaciones });
    porEnvio.set(item.numeroEnvio, grupo);
  }

  return {
    sinEnviar,
    envios: [...porEnvio.entries()].sort(([a], [b]) => a - b).map(([numero, grupo]) => ({ numero, items: grupo })),
  };
}

const COMENSALES_MAXIMO = 99;

/**
 * Comensales al abrir la cuenta, o al corregirlos después (docs/plan-comensales-y-limite-mesas-2026-09-26.md): entero entre 1 y
 * {@link COMENSALES_MAXIMO}, SIN valor por defecto — quien llama tiene que mandar un número, nunca se completa solo (ver el
 * docstring de `Cuenta.comensales` en prisma/schema.prisma: un default sesgaría la métrica de rotación que existe para medir).
 * Solo enteros: no tiene sentido "2,5 comensales".
 */
export function validarComensales(valor: unknown): { ok: true; comensales: number } | { ok: false; mensaje: string } {
  const n = typeof valor === "number" ? valor : Number.NaN;
  if (!Number.isInteger(n) || !esNumeroFinito(n) || n < 1 || n > COMENSALES_MAXIMO) {
    return { ok: false, mensaje: `La cantidad de comensales tiene que ser un número entero entre 1 y ${COMENSALES_MAXIMO}.` };
  }
  return { ok: true, comensales: n };
}

/** Motivo de anulación de un ítem ya enviado: obligatorio (sin espacios sueltos) y de hasta 200 caracteres. */
export function validarMotivoAnulacion(motivo: unknown): { ok: true; motivo: string } | { ok: false; mensaje: string } {
  const v = texto(motivo);
  if (!v) return { ok: false, mensaje: "Escribí el motivo de la anulación." };
  if (v.length > LARGO_MAXIMO_MOTIVO_ANULACION) return { ok: false, mensaje: `El motivo no puede superar los ${LARGO_MAXIMO_MOTIVO_ANULACION} caracteres.` };
  return { ok: true, motivo: v };
}

export interface ItemDeCuenta {
  id: string;
  productoId: string;
  productoNombre: string;
  /** Decimales que acepta la unidad de stock del producto (para la cantidad de una anulación parcial). */
  decimales: number;
  cantidad: number;
  /** Precio congelado al pedir: con el descuento de PRODUCTO ya aplicado, si lo tenía. */
  precioUnitario: number;
  /** Producto con descuento: el precio de lista que tenía antes de ese descuento (se muestra tachado); null si no tuvo (y siempre null en un
   *  componente de promo). */
  precioListaUnitario: number | null;
  numeroEnvio: number | null;
  anulaAItemId: string | null;
  motivoAnulacion: string | null;
  /** Quién cargó el ítem (o quién anuló, en un espejo); null en filas anteriores a «tomar pedido». */
  creadoPor: string | null;
  creadoEn: Date;
  /** Task #16 (docs/plan-promo-combo-2026-09-26.md, paso 10): la promo de la que este ítem es un componente — null en un
   *  suelto de siempre. `promoTitulo` es el snapshot congelado (`PromoCuenta.titulo`), no el título actual de `PromoCarta`. */
  promoCuentaId: string | null;
  promoTitulo: string | null;
  /** El nombre compuesto de la línea con opciones («Café solo chico») y su renglón de detalle (lo incluido): lo que se MUESTRA y se comanda. `productoNombre` sigue siendo el del producto (identifica el ítem). Ausentes sin opciones. */
  nombreDeLinea?: string;
  detalleDeLinea?: string;
  /** GO-2b: `true` SOLO en un adicional (cuelga de la línea de su producto: no lleva descuento de cliente y no se anula solo). */
  esAdicional?: true;
  /** GO-2d: la línea de la que cuelga un adicional (para mostrarlo debajo de su producto). Ausente en las demás. */
  lineaPadreId?: string;
  /** GO-2d: lo elegido según la foto (opción y cuántas por unidad), para «Otro igual». Ausente sin opciones o si la consulta no lo leyó. */
  elegidas?: { opcionId: string; cantidad: number }[];
}

export interface DetalleDeCuenta {
  id: string;
  abiertaEn: Date;
  mesero: string;
  tiempoAbierta: string;
  /** `null` = cuenta abierta antes de este campo (sin backfill) — ver el docstring de `Cuenta.comensales`. */
  comensales: number | null;
  /** Cliente con descuento asignado (Task #14, docs/plan-clientes-descuento-2026-09-26.md) — `null` = sin cliente, precio de lista. */
  clienteId: string | null;
  cliente: string | null;
  /** El % YA CONGELADO en la cuenta (`Cuenta.descuentoPorcentaje`), no el actual del `Cliente` — ver `asignarClienteACuenta`. */
  descuentoPorcentaje: number | null;
  /** Σ cantidad × precio COBRADO de TODAS las filas (espejos incluidos, con el descuento de cliente ya aplicado si hay uno): lo que
   *  se cobraría si se cerrara AHORA. Mismo cálculo que `cerrarCuenta`/el ticket (`precioConDescuento`, src/core/moneda.ts). */
  total: number;
  sinEnviar: ItemDeCuenta[];
  envios: { numero: number; items: ItemEnEnvio<ItemDeCuenta>[] }[];
  /** Cantidad de filas de la cuenta (originales + espejos): «Liberar mesa» solo aplica con cero. */
  itemsTotales: number;
}

export interface DetalleDeMesa {
  mesa: { id: string; numero: number };
  cuenta: DetalleDeCuenta | null;
}

/** La mesa pedida con su cuenta abierta (si tiene) y sus ítems, tal como la lee la consulta (`server/consultas/pos/detalle-de-mesa.ts`): importes ya en números. */
export interface MesaConCuentaLeida {
  id: string;
  numero: number;
  cuentas: {
    id: string;
    abiertaEn: Date;
    comensales: number | null;
    clienteId: string | null;
    cliente: { nombre: string } | null;
    descuentoPorcentaje: number | null;
    abiertaPor: { name: string | null; email: string };
    items: {
      id: string;
      productoId: string;
      producto: { nombre: string; modoDeVenta: string; unidadStock: { decimales: number } };
      cantidad: number;
      precioUnitario: number;
      precioCartaUnitario: number | null;
      numeroEnvio: number | null;
      anulaAItemId: string | null;
      motivoAnulacion: string | null;
      creadoPor: { name: string | null; email: string } | null;
      creadoEn: Date;
      promoCuenta: { id: string; titulo: string } | null;
      /** GO-2b: el padre de un adicional y la foto de lo elegido (opcionales: sin ellos, el detalle de siempre). */
      lineaPadreId?: string | null;
      opcionesElegidas?: (FotoParaElNombre & { opcionId?: string })[];
    }[];
  }[];
}

/**
 * La mesa pedida con su cuenta abierta (si tiene), agrupada por envío, a partir de las filas ya leídas. `null` si la mesa no existe o no es de esta sucursal
 * (eso lo decide la consulta: `obtenerDetalleDeMesa` en `server/consultas/pos/detalle-de-mesa.ts`, donde vive el aislamiento por sucursal).
 */
export function armarDetalleDeMesa(mesa: MesaConCuentaLeida | null, ahora: Date): DetalleDeMesa | null {
  if (!mesa) return null;

  const fila = mesa.cuentas[0] ?? null; // el índice único parcial garantiza a lo sumo una abierta
  if (!fila) return { mesa: { id: mesa.id, numero: mesa.numero }, cuenta: null };

  const items: ItemDeCuenta[] = fila.items.map((i) => {
    const fotos = i.opcionesElegidas ?? [];
    const { nombre, detalle } = nombreDeLineaConfigurada(i.producto.nombre, esBaseConfigurable(i.producto.modoDeVenta), fotos);
    // GO-2d: lo elegido (opción y cuántas), solo de las fotos que lo traen.
    const elegidas = fotos.flatMap((f) => (f.opcionId !== undefined ? [{ opcionId: f.opcionId, cantidad: f.cantidad }] : []));
    return {
    id: i.id,
    productoId: i.productoId,
    productoNombre: i.producto.nombre,
    decimales: i.producto.unidadStock.decimales,
    cantidad: i.cantidad,
    precioUnitario: i.precioUnitario,
    precioListaUnitario: !i.promoCuenta && i.precioCartaUnitario !== null ? i.precioCartaUnitario : null,
    numeroEnvio: i.numeroEnvio,
    anulaAItemId: i.anulaAItemId,
    motivoAnulacion: i.motivoAnulacion,
    creadoPor: i.creadoPor ? nombreDelMesero(i.creadoPor) : null,
    creadoEn: i.creadoEn,
    promoCuentaId: i.promoCuenta?.id ?? null,
    promoTitulo: i.promoCuenta?.titulo ?? null,
    ...(fotos.some((f) => f.tipoGrupo !== "ADICIONAL") ? { nombreDeLinea: nombre } : {}),
    ...(detalle ? { detalleDeLinea: detalle } : {}),
    ...(i.lineaPadreId ? { esAdicional: true as const } : {}),
    ...(i.lineaPadreId ? { lineaPadreId: i.lineaPadreId } : {}),
    ...(elegidas.length ? { elegidas } : {}),
    };
  });
  const { sinEnviar, envios } = agruparPorEnvio(items);
  const descuentoPorcentaje = fila.descuentoPorcentaje;

  return {
    mesa: { id: mesa.id, numero: mesa.numero },
    cuenta: {
      id: fila.id,
      abiertaEn: fila.abiertaEn,
      mesero: nombreDelMesero(fila.abiertaPor),
      tiempoAbierta: tiempoDesde(fila.abiertaEn, ahora),
      comensales: fila.comensales,
      clienteId: fila.clienteId,
      cliente: fila.cliente?.nombre ?? null,
      descuentoPorcentaje,
      // Σ del importe COBRADO de cada línea (importeDeLinea sobre precioCobradoConDescuentos), no la suma cruda re-redondeada: así el total
      // en pantalla nunca difiere del que registraría un cierre inmediato (ticket y cerrarCuenta usan el mismo criterio; sin cliente ni
      // descuento de producto, el precio queda tal cual). Con los dos descuentos rige solo el mayor. redondearMoneda solo limpia el ruido del float.
      // GO-2b: el adicional va sin descuento de cliente (igual que el cierre y el ticket).
      total: redondearMoneda(
        items.reduce((suma, i) => suma + importeDeLinea(i.cantidad, precioCobradoConDescuentos(i.precioUnitario, i.precioListaUnitario, i.esAdicional ? null : descuentoPorcentaje).precio), 0)
      ),
      sinEnviar,
      envios,
      itemsTotales: items.length,
    },
  };
}
