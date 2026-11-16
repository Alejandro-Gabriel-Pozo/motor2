"use server";

import { guardComandoAnularOrdenDeCompra, guardComandoConfigurarControlDeExceso, guardComandoCrearOrdenDeCompra, guardComandoDeOrdenDeCompra } from "@/core/features/compras/orden-de-compra.guard";
import type { LineaDeOrdenInput } from "@/core/features/compras/orden-de-compra.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { requerirVerDeEmpresa } from "../con-sesion";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { listarOrdenesPedidasParaElegir, type OrdenParaMostrar } from "@/server/lecturas/movimientos/ordenes-de-compra";
import { anularOrdenDeCompraCasoDeUso } from "./casos-de-uso/anular-orden-de-compra";
import { cerrarOrdenDeCompraCasoDeUso } from "./casos-de-uso/cerrar-orden-de-compra";
import { configurarControlDeExcesoCasoDeUso } from "./casos-de-uso/configurar-control-de-exceso";
import { crearOrdenDeCompraCasoDeUso } from "./casos-de-uso/crear-orden-de-compra";
import { pedirOrdenDeCompraCasoDeUso } from "./casos-de-uso/pedir-orden-de-compra";

/**
 * Compras, orden de compra (etapa OC): las Server Actions de la orden. Adaptadores finos: permiso → formato → caso de uso → `aResultadoAccion`. Crear, pedir, anular y cerrar piden `orden_de_compra_gestionar` (gerente y administrador: el operador queda
 * rechazado en el servidor) y configurar el control pide `compras_configurar`; ambas del módulo `ordenes_de_compra` (apagado por defecto: sin él, el servidor las rechaza). Ninguna refresca la vista: quien llama es un componente de cliente que pide el `router.refresh()`.
 */

/** «Crear la orden» (nace BORRADOR). `claveIdempotencia` la genera la pantalla al abrirse (misma clave = la misma orden). */
export async function crearOrdenDeCompra(datos: {
  proveedorId: string;
  sucursalId?: string | null;
  fechaDeEntregaPrevista?: string | null;
  lineas: LineaDeOrdenInput[];
  claveIdempotencia: string;
}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("orden_de_compra_gestionar", async (ctx) => {
    const comando = guardComandoCrearOrdenDeCompra(datos);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await crearOrdenDeCompraCasoDeUso(ctx, comando.valor, azarDelProceso));
  });
}

/** «Pedir la orden»: BORRADOR → PEDIDA, con su número. Sin segunda aprobación. Idempotente por estado. */
export async function pedirOrdenDeCompra(ordenId: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("orden_de_compra_gestionar", async (ctx) => {
    const comando = guardComandoDeOrdenDeCompra({ ordenId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await pedirOrdenDeCompraCasoDeUso(ctx, comando.valor));
  });
}

/** «Anular la orden» (BORRADOR o PEDIDA) con motivo; solo sin compras vigentes contra ella. Idempotente por estado. */
export async function anularOrdenDeCompra(ordenId: string, motivo: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("orden_de_compra_gestionar", async (ctx) => {
    const comando = guardComandoAnularOrdenDeCompra({ ordenId, motivo });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularOrdenDeCompraCasoDeUso(ctx, comando.valor));
  });
}

/** «Cerrar la orden» a mano (PEDIDA → CERRADA), sin compras pendientes de recibir contra ella. Idempotente por estado. */
export async function cerrarOrdenDeCompra(ordenId: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("orden_de_compra_gestionar", async (ctx) => {
    const comando = guardComandoDeOrdenDeCompra({ ordenId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await cerrarOrdenDeCompraCasoDeUso(ctx, comando.valor));
  });
}

/** «Configurar el control»: el nivel (permitir, avisar o bloquear) de recibir más de lo pedido en una orden. Solo gerente y administrador. */
export async function configurarControlDeExceso(nivel: string): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("compras_configurar", async (ctx) => {
    const comando = guardComandoConfigurarControlDeExceso({ nivel });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await configurarControlDeExcesoCasoDeUso(ctx, comando.valor, azarDelProceso));
  });
}

/** Las órdenes PEDIDAS de un proveedor (sin precios) para elegir una al cargar una compra. Pide el «Ver» de `orden_de_compra_ver` (módulo `ordenes_de_compra`). */
export async function listarOrdenesParaElegir(proveedorId: string): Promise<OrdenParaMostrar[]> {
  const ctx = await requerirVerDeEmpresa("orden_de_compra_ver");
  return listarOrdenesPedidasParaElegir(ctx.db, proveedorId);
}
