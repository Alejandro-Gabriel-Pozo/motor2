"use server";

import { guardComandoActualizarMaxMesasAbiertas, guardComandoCrearMesa } from "@/core/features/mesas/mesas.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { actualizarMaxMesasAbiertasCasoDeUso } from "./casos-de-uso/actualizar-max-mesas-abiertas";
import { crearMesaCasoDeUso } from "./casos-de-uso/crear-mesa";

/**
 * Alta de una mesa del salón en la sucursal activa (módulo POS, docs/plan-mapa-de-mesas-2026-09-24.md, paso 3). Sin baja ni
 * renumeración. Abrir/cerrar cuentas vive en src/server/actions/pos/cuenta-*.ts («tomar pedido»); editar el límite de mesas abiertas
 * de la sucursal, más abajo en este mismo archivo (`actualizarMaxMesasAbiertas`, con su propia clave, `pos_limite_mesas_abiertas`).
 * Sin auditoría administrativa (no es un precio ni un permiso).
 *
 * El número es único por sucursal (`@@unique([sucursalId, numero])`): el choque se detecta en la base (P2002) y no con una
 * lectura previa, así dos altas simultáneas del mismo número no pueden pasar las dos.
 *
 * No llama a `refrescarVistaSiHaceFalta`: su único llamador (`NuevaMesa`, un componente de cliente) ya hace `router.refresh()`.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 3) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_alta_mesa")`) → formato del número
 * (`guardComandoCrearMesa`, core/features/mesas/mesas.guard.ts, DENTRO del envoltorio) → caso de uso (`casos-de-uso/crear-mesa.ts`: la escritura en
 * server/persistencia/pos/mesas.ts y la traducción del número repetido) → `aResultadoAccion`.
 */
export async function crearMesa(numero: number): Promise<ResultadoAccion> {
  return conPermiso("pos_alta_mesa", async (ctx) => {
    const comando = guardComandoCrearMesa(numero);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await crearMesaCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Edita el límite de mesas ABIERTAS a la vez en la sucursal activa (`Sucursal.maxMesasAbiertas`,
 * docs/plan-comensales-y-limite-mesas-2026-09-26.md, D6: bloqueo en seco, sin excepción de permiso especial). Con su propia clave,
 * `pos_limite_mesas_abiertas` (desde la partición de claves del 2026-09-30, `20261001130000_particion_permisos_stock_pos_catalogo`; hasta el Hito 4 este
 * comentario todavía decía `pos_mesas`). `limite: null` = sin límite. Bajarlo por
 * debajo de las mesas ya abiertas no cierra ninguna: `abrirCuenta` es quien lo hace cumplir, dentro de su propia transacción.
 *
 * Auditado (entidad "Sucursal", campo "maxMesasAbiertas"): es un cambio de configuración de negocio, igual que un precio o un
 * permiso.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 4) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_limite_mesas_abiertas")`) → formato del
 * límite (`guardComandoActualizarMaxMesasAbiertas`, core/features/mesas/mesas.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/actualizar-max-mesas-abiertas.ts`: la sucursal, la auditoría y el cambio en server/persistencia/pos/mesas.ts, sin transacción como antes) →
 * `aResultadoAccion`. Con `crearMesa` (paso 3) también migrada, el archivo entero está en `ACCIONES_CON_CASO_DE_USO`.
 */
export async function actualizarMaxMesasAbiertas(limite: number | null): Promise<ResultadoAccion> {
  return conPermiso("pos_limite_mesas_abiertas", async (ctx) => {
    const comando = guardComandoActualizarMaxMesasAbiertas(limite);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await actualizarMaxMesasAbiertasCasoDeUso(ctx, comando.valor));
  });
}
