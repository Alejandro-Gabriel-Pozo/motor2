/**
 * ORÁCULO de «declarar el pago de una factura de proveedor» (Pagos X0; docs/diseno-pagos-x0-2026-11-04.md §10). Escrito A MANO y APARTE del código: es la tabla de lo que el dueño espera, no un espejo de `decidirDeclaracionDePago`.
 *
 * Cómo se lee. Una factura se puede cargar «pagada al cargar» (CONTADO_PAGADA) o «pendiente de pago» (PENDIENTE_DE_PAGO). Solo a la pendiente, que no esté anulada y que no tenga ya un pago vigente, se le puede declarar un pago, y la fecha
 * del pago tiene que estar entre el día de la factura (inclusive) y hoy (inclusive; hora de Argentina). Si hay varias razones para rechazar, se informa la primera de esta lista: factura anulada → pagada al cargar → ya tiene pago
 * vigente → fecha fuera de rango.
 *
 * Los cinco valores de fecha, con una factura del jueves 2026-10-29 y hoy miércoles 2026-11-04 (la factura del viernes y el pago del martes de la necesidad del dueño caen en «ENTRE_LA_FACTURA_Y_HOY»):
 *   ANTES_DE_LA_FACTURA 2026-10-28 · MISMO_DIA_QUE_LA_FACTURA 2026-10-29 · ENTRE_LA_FACTURA_Y_HOY 2026-11-02 · HOY 2026-11-04 · MANANA 2026-11-05.
 *
 * Qué dimensiones cambian dinero, permisos o visibilidad (el guardián de `declarar-pago-oraculo.test.ts` falla si aparece una sin declarar acá):
 *  - de la REGLA PURA: condición de pago, anulada, pago vigente, fecha frente a la factura y a hoy (las cuatro primeras columnas de la tabla);
 *  - del COMANDO (lo cubre el test de integración): permiso `declarar_pago_compra` (con / sin), factura simple (una parte) o repartida, medio (5 válidos y uno inválido), clave de reintento repetida, otra empresa.
 *  - de la TABLA `PagoDeFacturaProveedor`: cada columna declara si cambia el resultado (`COLUMNAS_DEL_PAGO`).
 */

export const HOY = "2026-11-04";
export const DIA_DE_LA_FACTURA = "2026-10-29";

export const DIAS_DE_PAGO = {
  ANTES_DE_LA_FACTURA: "2026-10-28",
  MISMO_DIA_QUE_LA_FACTURA: "2026-10-29",
  ENTRE_LA_FACTURA_Y_HOY: "2026-11-02",
  HOY: "2026-11-04",
  MANANA: "2026-11-05",
} as const;

export type FechaDelPago = keyof typeof DIAS_DE_PAGO;
export type Condicion = "CONTADO_PAGADA" | "PENDIENTE_DE_PAGO";
export type Resultado = "OK" | "FACTURA_ANULADA" | "NO_ADMITE_PAGO" | "YA_TIENE_PAGO" | "FECHA_FUERA_DE_RANGO";

/** [condición, anulada, tiene pago vigente, fecha del pago, resultado esperado]. Las 40 combinaciones, una por una. */
export const FILAS: ReadonlyArray<readonly [Condicion, boolean, boolean, FechaDelPago, Resultado]> = [
  ["CONTADO_PAGADA", false, false, "ANTES_DE_LA_FACTURA", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, false, "MISMO_DIA_QUE_LA_FACTURA", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, false, "ENTRE_LA_FACTURA_Y_HOY", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, false, "HOY", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, false, "MANANA", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, true, "ANTES_DE_LA_FACTURA", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, true, "MISMO_DIA_QUE_LA_FACTURA", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, true, "ENTRE_LA_FACTURA_Y_HOY", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, true, "HOY", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", false, true, "MANANA", "NO_ADMITE_PAGO"],
  ["CONTADO_PAGADA", true, false, "ANTES_DE_LA_FACTURA", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, false, "MISMO_DIA_QUE_LA_FACTURA", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, false, "ENTRE_LA_FACTURA_Y_HOY", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, false, "HOY", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, false, "MANANA", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, true, "ANTES_DE_LA_FACTURA", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, true, "MISMO_DIA_QUE_LA_FACTURA", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, true, "ENTRE_LA_FACTURA_Y_HOY", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, true, "HOY", "FACTURA_ANULADA"],
  ["CONTADO_PAGADA", true, true, "MANANA", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", false, false, "ANTES_DE_LA_FACTURA", "FECHA_FUERA_DE_RANGO"],
  ["PENDIENTE_DE_PAGO", false, false, "MISMO_DIA_QUE_LA_FACTURA", "OK"],
  ["PENDIENTE_DE_PAGO", false, false, "ENTRE_LA_FACTURA_Y_HOY", "OK"],
  ["PENDIENTE_DE_PAGO", false, false, "HOY", "OK"],
  ["PENDIENTE_DE_PAGO", false, false, "MANANA", "FECHA_FUERA_DE_RANGO"],
  ["PENDIENTE_DE_PAGO", false, true, "ANTES_DE_LA_FACTURA", "YA_TIENE_PAGO"],
  ["PENDIENTE_DE_PAGO", false, true, "MISMO_DIA_QUE_LA_FACTURA", "YA_TIENE_PAGO"],
  ["PENDIENTE_DE_PAGO", false, true, "ENTRE_LA_FACTURA_Y_HOY", "YA_TIENE_PAGO"],
  ["PENDIENTE_DE_PAGO", false, true, "HOY", "YA_TIENE_PAGO"],
  ["PENDIENTE_DE_PAGO", false, true, "MANANA", "YA_TIENE_PAGO"],
  ["PENDIENTE_DE_PAGO", true, false, "ANTES_DE_LA_FACTURA", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, false, "MISMO_DIA_QUE_LA_FACTURA", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, false, "ENTRE_LA_FACTURA_Y_HOY", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, false, "HOY", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, false, "MANANA", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, true, "ANTES_DE_LA_FACTURA", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, true, "MISMO_DIA_QUE_LA_FACTURA", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, true, "ENTRE_LA_FACTURA_Y_HOY", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, true, "HOY", "FACTURA_ANULADA"],
  ["PENDIENTE_DE_PAGO", true, true, "MANANA", "FACTURA_ANULADA"],
];

/** Las dimensiones de la regla pura y sus valores: el guardián exige que la tabla las cruce TODAS. */
export const DIMENSIONES_DE_LA_REGLA = {
  condicion: ["CONTADO_PAGADA", "PENDIENTE_DE_PAGO"],
  anulada: [false, true],
  tienePagoVigente: [false, true],
  fecha: ["ANTES_DE_LA_FACTURA", "MISMO_DIA_QUE_LA_FACTURA", "ENTRE_LA_FACTURA_Y_HOY", "HOY", "MANANA"],
} as const;

/** Los medios de pago que el dueño espera (cualquier otro se rechaza). */
export const MEDIOS_ESPERADOS = ["TRANSFERENCIA", "EFECTIVO", "CHEQUE", "TARJETA", "OTRO"] as const;

/** Las condiciones de pago que el dueño espera. */
export const CONDICIONES_ESPERADAS = ["CONTADO_PAGADA", "PENDIENTE_DE_PAGO"] as const;

/**
 * Cada columna de `PagoDeFacturaProveedor` y si cambia el resultado de declarar o el estado de pago visible. Una columna nueva sin declarar acá hace fallar el guardián: hay que decidir si es una dimensión nueva
 * (y entonces la tabla de arriba o el test de integración tienen que cubrirla) o si es solo un dato.
 */
export const COLUMNAS_DEL_PAGO: Readonly<Record<string, { afecta: boolean; porque: string }>> = {
  id: { afecta: false, porque: "identificador" },
  empresaId: { afecta: true, porque: "aislamiento: un pago es de una sola empresa (RLS); lo cubre el test de otra empresa" },
  facturaProveedorId: { afecta: true, porque: "un único pago vigente por factura (dimensión «tiene pago vigente»)" },
  fechaPago: { afecta: true, porque: "dimensión «fecha del pago»: entre el día de la factura y hoy; define el mes del flujo de caja" },
  medio: { afecta: true, porque: "lista cerrada de cinco medios (MEDIOS_ESPERADOS)" },
  claveIdempotencia: { afecta: true, porque: "repetir la clave no duplica; lo cubre el test de idempotencia" },
  payloadHash: { afecta: false, porque: "huella para detectar la misma clave con otros datos; no abre ni cierra nada por sí sola" },
  resultadoMensaje: { afecta: false, porque: "texto que se devuelve al repetir" },
  creadoPorId: { afecta: false, porque: "trazabilidad: quién declaró" },
  creadoEn: { afecta: false, porque: "trazabilidad: cuándo declaró" },
  anuladoEn: { afecta: true, porque: "dimensión «tiene pago vigente»: un pago anulado deja de contar" },
  anuladoPorId: { afecta: false, porque: "trazabilidad: quién anuló" },
};

/** Cada dato de entrada de la regla pura (`EntradaDeDeclaracionDePago`) y a qué dimensión de la tabla corresponde. Un dato nuevo sin declarar acá hace fallar el guardián. */
export const ENTRADAS_DE_LA_REGLA: Readonly<Record<string, keyof typeof DIMENSIONES_DE_LA_REGLA>> = {
  condicionPago: "condicion",
  anulada: "anulada",
  tienePagoVigente: "tienePagoVigente",
  diaFactura: "fecha",
  diaPago: "fecha",
  hoy: "fecha",
};
