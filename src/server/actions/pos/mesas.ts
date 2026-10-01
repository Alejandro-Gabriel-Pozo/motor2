"use server";

import { esNumeroFinito } from "@/core/numero";
import { esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { validarMaxMesasAbiertas } from "@/core/pos/mesas";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

// Sin `export`: un archivo "use server" solo puede exportar funciones async (cada export es un endpoint).
const NUMERO_MESA_MAXIMO = 9999;

/**
 * Alta de una mesa del salón en la sucursal activa (módulo POS, docs/plan-mapa-de-mesas-2026-09-24.md, paso 3). Sin baja ni
 * renumeración. Abrir/cerrar cuentas vive en src/server/actions/pos/cuenta-*.ts («tomar pedido»); editar el límite de mesas abiertas
 * de la sucursal, más abajo en este mismo archivo (`actualizarMaxMesasAbiertas`, mismo permiso `pos_mesas`).
 * Sin auditoría administrativa (no es un precio ni un permiso).
 *
 * El número es único por sucursal (`@@unique([sucursalId, numero])`): el choque se detecta en la base (P2002) y no con una
 * lectura previa, así dos altas simultáneas del mismo número no pueden pasar las dos.
 *
 * No llama a `refrescarVistaSiHaceFalta`: su único llamador (`NuevaMesa`, un componente de cliente) ya hace `router.refresh()`.
 */
export async function crearMesa(numero: number): Promise<ResultadoAccion> {
  return conPermiso("pos_alta_mesa", async (ctx) => {
    if (!Number.isInteger(numero) || !esNumeroFinito(numero) || numero < 1 || numero > NUMERO_MESA_MAXIMO) {
      return error(`El número de mesa tiene que ser un entero entre 1 y ${NUMERO_MESA_MAXIMO}.`);
    }
    try {
      await ctx.db.mesa.create({ data: { sucursalId: ctx.sucursalId, numero } });
    } catch (e) {
      if (esErrorDeUnicidad(e)) return error(`Ya existe la mesa ${numero} en esta sucursal.`);
      throw e;
    }
    return ok(`Mesa ${numero} creada.`);
  });
}

/**
 * Edita el límite de mesas ABIERTAS a la vez en la sucursal activa (`Sucursal.maxMesasAbiertas`,
 * docs/plan-comensales-y-limite-mesas-2026-09-26.md, D6: bloqueo en seco, sin excepción de permiso especial). Mismo permiso que dar
 * de alta mesas (`pos_mesas`): no hace falta uno nuevo. `limite: null` = sin límite. Bajarlo por debajo de las mesas ya abiertas no
 * cierra ninguna: `abrirCuenta` es quien lo hace cumplir, dentro de su propia transacción.
 *
 * Auditado (entidad "Sucursal", campo "maxMesasAbiertas"): es un cambio de configuración de negocio, igual que un precio o un
 * permiso.
 */
export async function actualizarMaxMesasAbiertas(limite: number | null): Promise<ResultadoAccion> {
  return conPermiso("pos_limite_mesas_abiertas", async (ctx) => {
    const val = validarMaxMesasAbiertas(limite);
    if (!val.ok) return error(val.mensaje);

    const sucursal = await ctx.db.sucursal.findUniqueOrThrow({ where: { id: ctx.sucursalId } });
    await registrarCambioAuditado(ctx.db, {
      entidad: "Sucursal",
      entidadId: sucursal.id,
      descripcion: `Sucursal "${sucursal.nombre}": límite de mesas abiertas`,
      campo: "maxMesasAbiertas",
      valorAnterior: sucursal.maxMesasAbiertas,
      valorNuevo: val.limite,
      actorId: ctx.usuarioId,
      sucursalId: ctx.sucursalId,
    });
    await ctx.db.sucursal.update({ where: { id: sucursal.id }, data: { maxMesasAbiertas: val.limite } });
    return ok(val.limite === null ? `Sin límite de mesas abiertas en «${sucursal.nombre}».` : `Máximo de mesas abiertas en «${sucursal.nombre}»: ${val.limite}.`);
  });
}
