"use server";

import { guardComandoActualizarCliente, guardComandoAltaCliente } from "@/core/features/clientes/clientes.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";
import { actualizarActivoClienteCasoDeUso } from "./casos-de-uso/actualizar-activo-cliente";
import { actualizarClienteCasoDeUso } from "./casos-de-uso/actualizar-cliente";
import { altaClienteCasoDeUso } from "./casos-de-uso/alta-cliente";

/**
 * Cliente con % de descuento fijo (Task #14, docs/plan-clientes-descuento-2026-09-26.md). Catálogo CENTRAL, sin `sucursalId` — mismo
 * criterio y mismo molde de CRUD que `categorias-producto.ts`/`proveedores.ts`: alta con dedup case-insensible, edición del nombre y
 * el % (no hay un campo "código" separado que sea la identidad, así que a diferencia de Proveedor el nombre SÍ se puede corregir), y
 * activar/desactivar en vez de borrar (una `Cuenta`/`Operacion` ya cerrada referencia su cliente para siempre, FK RESTRICT).
 *
 * Todo cambio deja su fila en la auditoría administrativa (entidad "Cliente", sin sucursal: es del catálogo central), en la MISMA transacción
 * que el cambio: el % mueve plata (se congela en cada cuenta al asignarlo), así que tiene que quedar quién lo cargó o lo cambió y cuándo.
 *
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-15) las tres mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{alta-cliente,actualizar-cliente,actualizar-activo-cliente}.ts`; escrituras en server/persistencia/clientes/clientes.ts y la fila de auditoría
 * en core/features/clientes/auditoria-de-cliente.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las lecturas (H8) siguen acá con sus guardas.
 */

/** Lista completa del catálogo (pantalla «Clientes»): pide el «Ver» de `clientes`, no alcanza con estar logueado. */
export async function listarClientes() {
  const ctx = await requerirVerDeEmpresa("clientes");
  return ctx.db.cliente.findMany({ orderBy: { nombre: "asc" } });
}

/** Lo mínimo que necesita el selector de cliente del salón: solo activos, solo id/nombre/% — nunca la fila completa. Pide el «Ver» de `pos_asignar_cliente`. */
export async function listarClientesParaCuenta(): Promise<{ id: string; nombre: string; descuentoPorcentaje: number }[]> {
  const ctx = await requerirVer("pos_asignar_cliente");
  const clientes = await ctx.db.cliente.findMany({ where: { activo: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, descuentoPorcentaje: true } });
  return clientes.map((c) => ({ id: c.id, nombre: c.nombre, descuentoPorcentaje: Number(c.descuentoPorcentaje) }));
}

/**
 * Equivalente de crearCategoriaProducto (mismo dedup case-insensible), con el % de descuento validado (validarPorcentajeDescuento).
 *
 * Desde el Hito 4 (H4C-15): permiso (`conPermisoDeEmpresa("clientes")`) → formato (`guardComandoAltaCliente`, core/features/clientes/clientes.guard.ts, DENTRO
 * del envoltorio: el nombre y el %) → caso de uso (`casos-de-uso/alta-cliente.ts`: nombre libre, el alta y sus dos filas de auditoría en una transacción) →
 * `aResultadoAccion`, y si salió bien el id y el nombre (`okConId`).
 */
export async function altaCliente(nombre: string, descuentoPorcentaje: unknown): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("clientes", async (ctx) => {
    const comando = guardComandoAltaCliente({ nombre, descuentoPorcentaje });
    if (!comando.ok) return error(comando.mensaje);
    const r = await altaClienteCasoDeUso(ctx, comando.valor);
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Corrige nombre y/o % de un cliente ya creado. El % nuevo NO reescribe ninguna `Cuenta` ya asignada (D7 — el % queda congelado en
 * `Cuenta.descuentoPorcentaje` al asignar el cliente): solo aplica a asignaciones futuras.
 *
 * Desde el Hito 4 (H4C-15): permiso → formato (`guardComandoActualizarCliente`, el nombre y el %: finito, 0 ≤ % < 100, 2 decimales) → caso de uso
 * (`casos-de-uso/actualizar-cliente.ts`: leer el cliente, aplicar el rechazo del guard, nombre libre, escribir y auditar) → `aResultadoAccion`. El guard se CALCULA acá pero su
 * rechazo NO se devuelve acá: lo aplica el caso de uso después de leer el cliente, porque un cliente inexistente gana sobre un dato inválido (test/clientes/cliente-mensajes.test.ts).
 */
export async function actualizarCliente(clienteId: string, nombre: string, descuentoPorcentaje: unknown): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("clientes", async (ctx) => {
    const datos = guardComandoActualizarCliente({ nombre, descuentoPorcentaje });
    return aResultadoAccion(await actualizarClienteCasoDeUso(ctx, { clienteId, datos }));
  });
}

/**
 * Desde el Hito 4 (H4C-15): permiso → caso de uso (`casos-de-uso/actualizar-activo-cliente.ts`: leer el cliente, cambiar y auditar) → si salió bien, refrescar la
 * vista → `aResultadoAccion`. Sin guard (`SIN_GUARD`: solo recibe un id y un booleano).
 */
export async function actualizarActivoCliente(clienteId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("clientes", async (ctx) => {
    const resultado = await actualizarActivoClienteCasoDeUso(ctx, { clienteId, activo });
    // Se llama desde la lista sin redirigir después (ver src/server/actions/refrescar.ts). Un cliente que no existe no refresca (como antes).
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
