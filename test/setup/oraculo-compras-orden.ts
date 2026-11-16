import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirAnularOrden, decidirCerrarOrden, decidirExcesoContraLaOrden, decidirPedirOrden, decidirVinculoConOrden, validarDatosDeOrden } from "../../src/core/compras/public";
import type { EstadoDeOrden, NivelDeControl } from "../../src/core/compras/public";
import { modulosEfectivos } from "../../src/core/modulos/clausura";
import { denegacionDeModulo } from "../../src/core/permisos/modulo-de-la-accion";
import { nivelMinimoDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso, nivelDe } from "../../src/core/permisos/jerarquia";
import { ROL_EMPRESA_GERENTE } from "../../src/core/permisos/rol-empresa";
import { dimensionesDelOraculo, productoCartesiano, tablaDelOraculo, type TablaDelOraculo } from "./oraculo-una-sola-compra";

/**
 * Lector del oráculo de la orden de compra (`docs/oraculo-combinaciones-compras-orden-2026-11-17.md`). Las tablas de reglas viven APARTE del código; este archivo solo las PARSEA y traduce cada fila a la entrada de las reglas reales (no copia
 * ningún resultado esperado). Lo usan el test exhaustivo de las reglas puras, el de integración y el guardián de dimensiones declaradas.
 */
const TEXTO_DEL_ORACULO_DE_ORDEN = readFileSync(join(__dirname, "../../docs/oraculo-combinaciones-compras-orden-2026-11-17.md"), "utf8");

export const dimensionesDeOrden = (): Record<string, string[]> => dimensionesDelOraculo(TEXTO_DEL_ORACULO_DE_ORDEN);
export const tablaDeOrden = (seccion: string): TablaDelOraculo => tablaDelOraculo(seccion, TEXTO_DEL_ORACULO_DE_ORDEN);
export { productoCartesiano };

/** «Hoy» con que se evalúan las reglas. */
export const HOY = "2026-11-15";
type Fila = Record<string, string>;

const ACCION_DE: Record<string, "orden_de_compra_gestionar" | "compras_configurar" | "orden_de_compra_ver"> = {
  GESTIONAR: "orden_de_compra_gestionar",
  CONFIGURAR: "compras_configurar",
  VER: "orden_de_compra_ver",
};

/** La puerta de la Server Action: módulo → piso del rol, con las funciones reales del acceso. */
export function resultadoDePuerta(f: Fila): string {
  const efectivos = modulosEfectivos(f.M === "ENCENDIDO" ? ["compras", "recepcion_de_compras", "ordenes_de_compra"] : ["compras", "recepcion_de_compras"]);
  if (denegacionDeModulo("ordenes_de_compra", efectivos)) return "RECHAZA_MODULO_NO_ACTIVO";
  const nivel = nivelDe({ rolEmpresa: f.O === "GERENTE" ? ROL_EMPRESA_GERENTE : null, esAdminEnElContexto: f.O === "ADMINISTRADOR" });
  return nivelAlcanzaElPiso(nivel, nivelMinimoDeAccion(ACCION_DE[f.A]!)) ? "PERMITE" : "RECHAZA_SIN_PERMISO";
}

const LINEAS: Record<string, unknown> = {
  VALIDAS: [{ productoId: "p1", cantidad: 2, precio: 10 }],
  SIN_LINEAS: [],
  CANTIDAD_CERO: [{ productoId: "p1", cantidad: 0, precio: 10 }],
  PRECIO_NEGATIVO: [{ productoId: "p1", cantidad: 2, precio: -1 }],
  PRECIO_CERO: [{ productoId: "p1", cantidad: 2, precio: 0 }],
  SIN_PRECIO: [{ productoId: "p1", cantidad: 2, precio: null }],
  PRODUCTO_REPETIDO: [
    { productoId: "p1", cantidad: 2 },
    { productoId: "p1", cantidad: 3 },
  ],
};
const ENTREGA: Record<string, unknown> = { SIN_ENTREGA: undefined, ENTREGA_VALIDA: "2026-11-20", ENTREGA_ANTERIOR: "2026-11-14", ENTREGA_INVALIDA: "2026-13-45" };

export function resultadoDeDatos(f: Fila): string {
  const r = validarDatosDeOrden({ proveedorId: f.P === "CON_PROVEEDOR" ? "prv-1" : "", lineas: LINEAS[f.I!], fechaDeEntregaPrevista: ENTREGA[f.F!], hoy: HOY });
  return r.ok ? "ACEPTA" : `RECHAZA_${r.codigo}`;
}

const ENTREGA_AL_PEDIR: Record<string, string | null> = { SIN_ENTREGA: null, ENTREGA_HOY_O_FUTURA: HOY, ENTREGA_ANTERIOR: "2026-11-14" };
export function resultadoDePedir(f: Fila): string {
  const r = decidirPedirOrden({ estado: f.E as EstadoDeOrden, lineasNoRetiradas: f.L === "CON_LINEAS" ? 2 : 0, fechaDeEntregaPrevista: ENTREGA_AL_PEDIR[f.D!]!, hoy: HOY });
  return r.ok ? "PIDE" : `RECHAZA_${r.codigo}`;
}

const MOTIVO: Record<string, unknown> = { MOTIVO_VALIDO: "El proveedor no entregó", MOTIVO_VACIO: "   ", MOTIVO_INVALIDO: "Motivo <script>" };
export function resultadoDeAnular(f: Fila): string {
  const r = decidirAnularOrden({ estado: f.E as EstadoDeOrden, hayRecepcionesVigentes: f.V === "CON_COMPRAS_VIGENTES", motivo: MOTIVO[f.T!] });
  return r.ok ? "ANULA" : `RECHAZA_${r.codigo}`;
}

export function resultadoDeCerrar(f: Fila): string {
  const r = decidirCerrarOrden({ estado: f.E as EstadoDeOrden, hayRecepcionesPendientes: f.W === "CON_COMPRAS_PENDIENTES" });
  return r.ok ? "CIERRA" : `RECHAZA_${r.codigo}`;
}

/** Con la cantidad dentro de lo pedido (pedida 10, ya recibida 4, este renglón 5) el control de exceso no interviene. */
export function resultadoDeVinculo(f: Fila): string {
  const r = decidirVinculoConOrden({
    estadoDeLaOrden: f.E as EstadoDeOrden,
    mismoProveedor: f.Y === "MISMO_PROVEEDOR",
    lineaRetirada: f.G === "LINEA_RETIRADA",
    mismoProducto: f.H === "MISMO_PRODUCTO",
    nivel: "BLOQUEAR",
    confirmoExceso: false,
    recibidaHasta: 4,
    cantidad: 5,
    pedida: 10,
  });
  return r.ok ? "VINCULA" : `RECHAZA_${r.codigo}`;
}

export function resultadoDeExceso(f: Fila): string {
  return decidirExcesoContraLaOrden({
    nivel: (f.N === "SIN_FILA" ? null : f.N) as NivelDeControl | null,
    confirmoExceso: f.X === "CONFIRMO_EXCESO",
    recibidaHasta: 4,
    cantidad: f.Z === "EXCEDE_LO_PEDIDO" ? 7 : 5,
    pedida: 10,
    rechazadoPorElControl: f.K === "RENGLON_RECHAZADO",
  });
}
