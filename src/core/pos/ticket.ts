import { precioCobradoConDescuentos } from "@/core/carta/public";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { esBaseConfigurable, nombreDeLineaConfigurada, type FotoParaElNombre } from "@/core/opciones/public";
import { claveDeLineaDeVenta, lineasDeVenta } from "./cuenta";
import { nombreDelMesero } from "./mesas";
import type { NumeroDeTicket } from "./numeracion-ticket";

/**
 * Ticket de cierre de una cuenta: el documento para el CLIENTE, con precios (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md, B5/B8).
 * Otro documento que la comanda de cocina (src/core/pos/comanda.ts), con su propio tipo: nunca un «ticket genérico» con banderas.
 *
 * Derivada, sin tabla ni campo nuevo: una cuenta cerrada ya no cambia (`anularItemEnviado`/`quitarItemSinEnviar` la rechazan), así que
 * volver a armar `lineasDeVenta` sobre sus ítems da exactamente las líneas que `cerrarCuenta` registró como venta (una Operacion VENTA
 * por línea neta producto + precio congelado; las líneas con neto ≤ 0 no se venden y no aparecen), y el total, el mismo cálculo.
 * Sin forma de pago ni propina (no existen en el modelo) y sin el aviso de stock negativo (es información interna del Kardex: queda en
 * el aviso de la pantalla y en la auditoría). El NÚMERO del ticket sí es una fila propia, `EjemplarTicket`, que emite `cerrarCuenta`
 * (docs/plan-numeracion-ticket-2026-09-25.md): control interno de comandas, no comprobante fiscal.
 */

/** Cuántas cuentas cerradas con venta lista «Cuentas cerradas» en la pantalla de la mesa. */
export const TICKETS_RECIENTES_POR_MESA = 3;

export interface LineaDeTicket {
  producto: string;
  cantidad: number;
  /** Precio COBRADO (con el descuento del producto o del cliente ya aplicado — Task #14; rige solo el mayor de los dos). */
  precioUnitario: number;
  /** Precio de LISTA de esta línea, SOLO cuando algún descuento (de producto o de cliente) hizo que difiera de `precioUnitario`. */
  precioListaUnitario?: number;
  subtotal: number;
  /** Task #16 (promo-combo, paso 2.6/3): la `PromoCuenta` de la que forma parte esta línea — la cabecera ("1 × Menú del
   *  día") y cada uno de sus componentes (con `indentado: true`) comparten el mismo id. Ausente = un suelto de siempre. */
  promoCuentaId?: string;
  /** true SOLO en un componente de promo (nunca en su cabecera ni en un suelto): sangría en el papel ("2 × Empanada de
   *  carne"), sin precio propio impreso (D del paso 2.6) — `precioUnitario`/`subtotal` siguen siendo el prorrateo real
   *  (paso 8c), para quien necesite el número exacto (ej. el detalle de `/reportes/tickets`); la vista de cliente/cocina
   *  no lo muestra. */
  indentado?: boolean;
  /** El nombre de la línea con opciones, en un renglón («Café solo chico»; `nombreDeLineaConfigurada`): reemplaza al nombre del producto SOLO acá, nunca en `productoNombre`. Ausente sin opciones. */
  detalle?: string;
  /** GO-2b: `true` SOLO en un adicional (va justo después de la línea de su producto, sin descuento de cliente). Ausente en todas las demás. */
  esAdicional?: true;
}

/**
 * GO-2b (ADR-030): lo que un ítem aporta a la agrupación con opciones (todo opcional: sin ello, el ticket de siempre). `id`, la huella y el padre (los espejos los
 * repiten), el original de un espejo, la versión de la opción de un adicional (de su foto) y los nombres de las opciones dentro del precio (de la foto).
 */
export interface ConfiguracionDeItemTicket {
  id?: string;
  huellaOpciones?: string | null;
  lineaPadreId?: string | null;
  anulaAItemId?: string | null;
  versionDeAdicional?: string | null;
  /** El nombre compuesto de la línea («Café solo chico») y su renglón de detalle (lo incluido). Ausentes sin opciones: el ítem de siempre. */
  nombreDeLinea?: string;
  detalleDeLinea?: string;
}

/**
 * Si el último ejemplar impreso sigue valiendo (docs/plan-numeracion-ticket-2026-09-25.md, D6 y paso 6):
 * - «vigente»: ninguna Operacion VENTA de la cuenta se anuló después de imprimirlo (se reimprime tal cual, aunque sea un B);
 * - «desactualizada»: alguna se anuló DESPUÉS (anulación parcial de una línea desde Trazabilidad): hace falta el ejemplar de corrección;
 * - «anulada»: se anularon TODAS: no queda nada que cobrar ni que corregir.
 */
export type EstadoDeTicket = "vigente" | "desactualizada" | "anulada";

export interface TicketDeCuenta {
  cuentaId: string;
  cerradaEn: Date;
  /** Quién atendió: el mozo que abrió la cuenta. */
  mesero: string;
  /** Las líneas VIGENTES: sin las de una Operacion VENTA anulada. */
  lineas: LineaDeTicket[];
  total: number;
  /** ALGUNA Operacion VENTA de la cuenta se anuló (`anularVenta`). Si fueron todas, `estado` es «anulada». */
  ventaAnulada: boolean;
  /** El último ejemplar impreso («566-A», «566-B»…); null en una cuenta cerrada antes de la numeración (sin backfill). */
  numero: NumeroDeTicket | null;
  /** El ejemplar A que corrige el último ejemplar, si es una corrección (B, C…); null si el último es el A o no hay número. */
  corrigeA: NumeroDeTicket | null;
  estado: EstadoDeTicket;
  /** Cliente con descuento de la cuenta (Task #14), con el % YA CONGELADO (`Cuenta.descuentoPorcentaje`, nunca el actual del
   *  Cliente); null si no se le asignó ninguno. */
  cliente: { nombre: string; descuentoPorcentaje: number } | null;
}

/** Un ítem de la cuenta con la anulación de la Operacion VENTA que lo registró (null: vigente, o sin operación). */
export interface ItemConVenta extends ConfiguracionDeItemTicket {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  /** Producto con descuento: el precio de lista del suelto antes de ese descuento (`CuentaItem.precioCartaUnitario`); null/ausente si no tuvo.
   *  En un componente de promo se ignora (ahí es el precio de carta para repartir la promo). */
  precioCartaUnitario?: number | null;
  operacionId: string | null;
  anuladaEn: Date | null;
  /** Task #16 (docs/plan-promo-combo-2026-09-26.md, paso 10): la promo de la que este ítem es un componente — AUSENTE en un
   *  suelto de siempre (nunca `null`: mismo criterio que `armarTicket`). Pasa TAL CUAL a `armarTicket` (mismo campo, mismo
   *  nombre). */
  promo?: PromoDeItemTicket;
}

/**
 * Líneas y total del ticket TAL COMO SE VEÍA en el instante `impresaEn` (el reporte de tickets emitidos, Task #17: «como se
 * imprimió» un ejemplar viejo, no como está la cuenta ahora): `armarTicket` sobre los ítems cuya Operacion VENTA no estaba anulada
 * en ese momento — vigente (`anuladaEn === null`) o anulada DESPUÉS (`anuladaEn > impresaEn`, una anulación posterior a esa
 * impresión no le resta nada a lo que ese papel mostró). Es la misma cuenta que hace `estadoDeTicket` para decidir «desactualizada».
 */
export function armarTicketImpresoEn(items: readonly ItemConVenta[], impresaEn: Date, descuentoPorcentaje: number | null = null): { lineas: LineaDeTicket[]; total: number } {
  return armarTicket(
    items.filter((i) => i.anuladaEn === null || i.anuladaEn > impresaEn),
    descuentoPorcentaje
  );
}

/**
 * Líneas y total de lo que sigue vendido en `ahora` (el reloj entra por parámetro, Pureza Fase 3): el caso «impresaEn = este instante» de `armarTicketImpresoEn` (ninguna anulación
 * real puede ser posterior a "ahora", así que el filtro se reduce a `anuladaEn === null`). Funciona por línea porque `cerrarCuenta`
 * enlaza a la operación de su línea TODOS los ítems de esa línea (originales y filas espejo).
 */
export function armarTicketVigente(items: readonly ItemConVenta[], ahora: Date, descuentoPorcentaje: number | null = null): { lineas: LineaDeTicket[]; total: number } {
  return armarTicketImpresoEn(items, ahora, descuentoPorcentaje);
}

/** Estado del último ejemplar impreso en `impresaEn` (sin número: el cierre de la cuenta), según las Operaciones VENTA de la cuenta. */
export function estadoDeTicket(items: readonly Pick<ItemConVenta, "operacionId" | "anuladaEn">[], impresaEn: Date): EstadoDeTicket {
  const anulacionPorOperacion = new Map(items.flatMap((i) => (i.operacionId ? [[i.operacionId, i.anuladaEn] as const] : [])));
  const anulaciones = [...anulacionPorOperacion.values()];
  if (anulaciones.length > 0 && anulaciones.every((a) => a !== null)) return "anulada";
  return anulaciones.some((a) => a !== null && a > impresaEn) ? "desactualizada" : "vigente";
}

/** Un ítem con promo, para `armarTicket` (Task #16, paso 2.6/3): la promo de la que este ítem es un componente — `titulo` es
 *  el snapshot congelado de `PromoCuenta.titulo` (la carta pudo cambiar el nombre después). */
export interface PromoDeItemTicket {
  promoCuentaId: string;
  titulo: string;
}

/** El ítem en la forma de `lineasDeVenta`, con la configuración de GO-2b si la trae (sin ella, lo de siempre). La usan el ticket y «Tickets emitidos». */
export function itemParaLineaDeVenta(i: { productoId: string; cantidad: number; precioUnitario: number; precioCartaUnitario?: number | null; promo?: PromoDeItemTicket } & ConfiguracionDeItemTicket) {
  return {
    id: i.id,
    productoId: i.productoId,
    cantidad: i.cantidad,
    precioUnitario: i.precioUnitario,
    promoCuentaId: i.promo?.promoCuentaId,
    precioCartaUnitario: i.precioCartaUnitario,
    huellaOpciones: i.huellaOpciones,
    lineaPadreId: i.lineaPadreId,
    anulaAItemId: i.anulaAItemId,
    versionDeAdicional: i.versionDeAdicional,
  };
}

/** GO-2b: si alguna línea de la cuenta tiene opciones (huella o padre). Sin ninguna, los ítems se arman exactamente como antes (sin `id` ni nada de las opciones). */
export function cuentaConOpciones(items: readonly { huellaOpciones?: string | null; lineaPadreId?: string | null }[]): boolean {
  return items.some((i) => (i.huellaOpciones ?? null) !== null || (i.lineaPadreId ?? null) !== null);
}

/**
 * GO-2b: la configuración de un ítem desde lo que leyó la consulta (`opcionesElegidas`, la foto): el nombre compuesto de la línea («Café solo chico», con su detalle de lo
 * incluido) y la versión de la opción de un adicional. En una cuenta SIN opciones (`conOpciones` en false, ver `cuentaConOpciones`) devuelve `{}`: el ítem de siempre, bit a bit.
 */
export function configuracionDeItemLeido(conOpciones: boolean, i: {
  id?: string;
  huellaOpciones?: string | null;
  lineaPadreId?: string | null;
  anulaAItemId?: string | null;
  producto: { nombre: string; modoDeVenta: string };
  opcionesElegidas?: readonly (FotoParaElNombre & { versionDeOpcionId: string })[];
}): ConfiguracionDeItemTicket {
  if (!conOpciones) return {};
  const fotos = i.opcionesElegidas ?? [];
  const propias = fotos.some((f) => f.tipoGrupo !== "ADICIONAL");
  const { nombre, detalle } = nombreDeLineaConfigurada(i.producto.nombre, esBaseConfigurable(i.producto.modoDeVenta), fotos);
  const versionDeAdicional = fotos.find((f) => f.tipoGrupo === "ADICIONAL")?.versionDeOpcionId ?? null;
  return {
    ...(i.id !== undefined ? { id: i.id } : {}),
    ...(i.huellaOpciones ? { huellaOpciones: i.huellaOpciones } : {}),
    ...(i.lineaPadreId ? { lineaPadreId: i.lineaPadreId } : {}),
    ...(i.anulaAItemId ? { anulaAItemId: i.anulaAItemId } : {}),
    ...(versionDeAdicional ? { versionDeAdicional } : {}),
    ...(propias ? { nombreDeLinea: nombre } : {}),
    ...(detalle ? { detalleDeLinea: detalle } : {}),
  };
}

/**
 * Líneas netas y total del ticket, a partir de TODOS los ítems de la cuenta (originales y anulaciones), igual que `cerrarCuenta`.
 *
 * `descuentoPorcentaje` (Task #14, docs/plan-clientes-descuento-2026-09-26.md): el % YA CONGELADO de la cuenta
 * (`Cuenta.descuentoPorcentaje`), no el actual del `Cliente` — quien llama es responsable de pasar el snapshot correcto. `null` (el
 * caso de siempre) deja `precioUnitario`/`subtotal` en el precio de lista, igual que antes de esta Task. Con un descuento, cada línea
 * se recalcula con `precioConDescuento` (src/core/moneda.ts, MISMA función y MISMOS argumentos que usó `cerrarCuenta` al registrar
 * la venta): el resultado es determinístico, así que reproduce centavo a centavo lo que de verdad se cobró, sin tener que leer el
 * `MovimientoStock` de cada línea.
 *
 * `promo` por ítem (Task #16, paso 2.6/3): SIN ningún ítem con `promo`, la salida es EXACTAMENTE la de antes de esta Task (mismo
 * criterio aditivo del resto del plan). Con `promo`, los componentes de la MISMA `promoCuentaId` se agrupan bajo UNA línea
 * cabecera ("1 × Menú del día", `subtotal` = suma de lo cobrado por sus componentes) seguida de sus componentes, cada uno
 * `indentado: true` y sin precio propio impreso (el precio ya está en la cabecera) — el TOTAL del ticket no cambia: sigue
 * siendo la suma de TODOS los subtotales NETOS (`lineasDeVenta`), calculada ANTES de agrupar para mostrar, así que agrupar o no
 * agrupar nunca mueve un centavo del total.
 */
export function armarTicket(
  items: readonly ({ productoId: string; productoNombre: string; cantidad: number; precioUnitario: number; precioCartaUnitario?: number | null; promo?: PromoDeItemTicket } & ConfiguracionDeItemTicket)[],
  descuentoPorcentaje: number | null = null
): { lineas: LineaDeTicket[]; total: number } {
  const claveDe = (i: { productoId: string; precioUnitario: number; precioCartaUnitario?: number | null; promo?: PromoDeItemTicket }) =>
    claveDeLineaDeVenta({ productoId: i.productoId, precioUnitario: i.precioUnitario, promoCuentaId: i.promo?.promoCuentaId, precioCartaUnitario: i.precioCartaUnitario });
  const nombres = new Map(items.map((i) => [claveDe(i), i.productoNombre]));
  const tituloPorPromo = new Map(items.flatMap((i) => (i.promo ? [[i.promo.promoCuentaId, i.promo.titulo] as const] : [])));

  const netas = lineasDeVenta(items.map(itemParaLineaDeVenta));
  // El nombre de una línea configurada sale de su primer ítem ORIGINAL (los espejos no tienen foto), POR LÍNEA NETA: `nombres` (de arriba) no distingue la huella, y dos cafés del
  // mismo precio con distinta configuración son dos líneas.
  const porId = new Map(items.flatMap((i) => (i.id !== undefined ? [[i.id, i] as const] : [])));
  const configuradoDe = (l: (typeof netas)[number]) => (l.itemIds ?? []).map((id) => porId.get(id)).find((i) => i !== undefined && !i.anulaAItemId && i.nombreDeLinea !== undefined);
  // `promoCuentaId` de cada neta se guarda APARTE (no en `componentes`, que es exactamente `LineaDeTicket` sin promo): así, sin
  // ninguna promo, `componentes` sale IDÉNTICO al de antes de esta Task, sin ningún campo de más que limpiar.
  const promoCuentaIdDeLaNeta = netas.map((l) => l.promoCuentaId);
  const componentes: LineaDeTicket[] = netas.map((l) => {
    // GO-2b: el adicional se cobra sin descuento de cliente (igual que en `cerrarCuenta`), así el ticket coincide al centavo con lo registrado.
    const esAdicional = l.indicePadre !== undefined;
    const cobro = esAdicional ? { precio: l.precioUnitario, precioLista: null } : precioCobradoConDescuentos(l.precioUnitario, l.precioCartaUnitario ?? null, descuentoPorcentaje);
    const configurado = configuradoDe(l);
    return {
      producto: configurado?.nombreDeLinea ?? nombres.get(claveDeLineaDeVenta(l)) ?? "",
      cantidad: l.cantidad,
      precioUnitario: cobro.precio,
      ...(cobro.precioLista !== null ? { precioListaUnitario: cobro.precioLista } : {}),
      subtotal: importeDeLinea(l.cantidad, cobro.precio),
      ...(configurado?.detalleDeLinea ? { detalle: configurado.detalleDeLinea } : {}),
      ...(esAdicional ? { esAdicional: true as const } : {}),
    };
  });
  // El total es la suma de los subtotales NETOS — el mismo importe por línea que `cerrarCuenta` registra en cada VENTA —, no la
  // suma cruda re-redondeada: así coincide centavo a centavo con lo registrado, y no cambia si después se agrupan para mostrar.
  const total = redondearMoneda(componentes.reduce((suma, c) => suma + c.subtotal, 0));

  if (!tituloPorPromo.size) return { lineas: componentes, total };

  const totalPorPromo = new Map<string, number>();
  componentes.forEach((c, i) => {
    const promoCuentaId = promoCuentaIdDeLaNeta[i];
    if (promoCuentaId) totalPorPromo.set(promoCuentaId, redondearMoneda((totalPorPromo.get(promoCuentaId) ?? 0) + c.subtotal));
  });

  const lineas: LineaDeTicket[] = [];
  const cabeceraEmitida = new Set<string>();
  componentes.forEach((c, i) => {
    const promoCuentaId = promoCuentaIdDeLaNeta[i];
    if (!promoCuentaId) {
      lineas.push(c);
      return;
    }
    if (!cabeceraEmitida.has(promoCuentaId)) {
      cabeceraEmitida.add(promoCuentaId);
      const totalPromo = totalPorPromo.get(promoCuentaId)!;
      lineas.push({ producto: tituloPorPromo.get(promoCuentaId) ?? "", cantidad: 1, precioUnitario: totalPromo, subtotal: totalPromo, promoCuentaId });
    }
    lineas.push({ ...c, promoCuentaId, indentado: true });
  });
  return { lineas, total };
}

/** Una cuenta cerrada con venta, tal como la lee la consulta (`server/consultas/pos/tickets.ts`): importes ya en números. */
export interface CuentaCerradaLeida {
  id: string;
  cerradaEn: Date | null;
  descuentoPorcentaje: number | null;
  abiertaPor: { name: string | null; email: string };
  cliente: { nombre: string } | null;
  items: {
    productoId: string;
    producto: { nombre: string; modoDeVenta: string };
    cantidad: number;
    precioUnitario: number;
    precioCartaUnitario: number | null;
    operacionId: string | null;
    operacion: { anuladaEn: Date | null } | null;
    promoCuenta: { id: string; titulo: string } | null;
    /** GO-2b: el id, la configuración y la foto del ítem (opcionales: sin ellos, el ticket de siempre). */
    id?: string;
    huellaOpciones?: string | null;
    lineaPadreId?: string | null;
    anulaAItemId?: string | null;
    opcionesElegidas?: (FotoParaElNombre & { versionDeOpcionId: string })[];
  }[];
  ejemplaresTicket: {
    numero: number;
    ejemplar: number;
    emitidoEn: Date;
    corrigeA: { numero: number; ejemplar: number } | null;
  }[];
}

/** Los tickets de las cuentas cerradas ya leídas, de la más nueva a la más vieja (el orden lo trae la consulta). Puro: no consulta la base. */
export function armarTicketsDeCuentas(cuentas: readonly CuentaCerradaLeida[], ahora: Date): TicketDeCuenta[] {
  return cuentas.map((cuenta) => {
    const cerradaEn = cuenta.cerradaEn ?? new Date(0); // la consulta ya exige cerradaEn no nulo
    const conOpciones = cuentaConOpciones(cuenta.items);
    const items: ItemConVenta[] = cuenta.items.map((i) => ({
      productoId: i.productoId,
      productoNombre: i.producto.nombre,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
      precioCartaUnitario: i.precioCartaUnitario,
      operacionId: i.operacionId,
      anuladaEn: i.operacion?.anuladaEn ?? null,
      promo: i.promoCuenta ? { promoCuentaId: i.promoCuenta.id, titulo: i.promoCuenta.titulo } : undefined,
      ...configuracionDeItemLeido(conOpciones, i),
    }));
    // Cliente con descuento (Task #14): `descuentoPorcentaje` es el SNAPSHOT congelado de la cuenta, no el % actual de `Cliente`.
    const descuentoPorcentaje = cuenta.descuentoPorcentaje;
    const { lineas, total } = armarTicketVigente(items, ahora, descuentoPorcentaje);
    const ultimo = cuenta.ejemplaresTicket[0];
    return {
      cuentaId: cuenta.id,
      cerradaEn,
      mesero: nombreDelMesero(cuenta.abiertaPor),
      lineas,
      total,
      ventaAnulada: items.some((i) => i.anuladaEn !== null),
      numero: ultimo ? { numero: ultimo.numero, ejemplar: ultimo.ejemplar } : null,
      corrigeA: ultimo?.corrigeA ?? null,
      estado: estadoDeTicket(items, ultimo?.emitidoEn ?? cerradaEn),
      cliente: cuenta.cliente && descuentoPorcentaje !== null ? { nombre: cuenta.cliente.nombre, descuentoPorcentaje } : null,
    };
  });
}
