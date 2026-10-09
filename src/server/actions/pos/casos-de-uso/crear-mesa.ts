import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import type { ComandoCrearMesa, ResultadoCrearMesa } from "@/core/features/mesas/mesas.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { escribirMesaNueva } from "@/server/persistencia/pos/mesas";

/**
 * Caso de uso «dar de alta una mesa del salón» (Hito 4 de la pureza, bloque 4.1, paso 3 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que antes vivía en
 * línea en la Server Action `crearMesa` (`src/server/actions/pos/mesas.ts`), movido TAL CUAL: la misma escritura, sin transacción, con la base del contexto
 * (`actor.db`), y el mismo mensaje. La Server Action quedó como adaptador (`conPermiso("pos_alta_mesa")` → `guardComandoCrearMesa` → este caso de uso →
 * `aResultadoAccion`). El criterio de negocio (sin baja ni renumeración, número único por sucursal) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso`) ni el rango del número (`guardComandoCrearMesa`).
 *
 * El número repetido lo detecta la BASE (índice único `(sucursalId, numero)`) y no una lectura previa: dos altas simultáneas del mismo número no pueden pasar
 * las dos (`test/pos/cuenta-concurrencia.test.ts`, (b)). Desde B2 (aprobado por el dueño) el choque lo reconoce `esChoqueDeIndiceUnico` (el helper de 1.7:
 * `P2002` o el `DriverAdapterError` crudo con `UniqueConstraintViolation`); antes era `esErrorDeUnicidad`, solo `P2002`
 * (`test/pos/choque-de-unicidad-del-driver.test.ts`).
 *
 * @contract Da de alta en la sucursal activa la mesa con el número pedido, salvo que ese número ya exista en la sucursal.
 * @idempotency Por estado — el índice único `(sucursalId, numero)` arbitra el reintento: un segundo pedido con el mismo número responde «Ya existe la mesa N» sin escribir.
 * @transaction Ninguna — una sola escritura con `actor.db`; la atomicidad la da la base.
 * @sideEffects Ninguno (la mesa es su propio documento: sin auditoría administrativa, como antes). Refrescar la vista lo hace el cliente (`router.refresh()`).
 * @ficha permiso=pos_alta_mesa transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearMesaCasoDeUso(actor: Pick<ContextoUsuario, "sucursalId" | "db">, comando: ComandoCrearMesa): Promise<ResultadoCrearMesa> {
  const { numero } = comando;
  try {
    await escribirMesaNueva(actor.db, { sucursalId: actor.sucursalId, numero });
  } catch (e) {
    if (esChoqueDeIndiceUnico(e)) return fracaso("NUMERO_REPETIDO", `Ya existe la mesa ${numero} en esta sucursal.`);
    throw e;
  }
  return exito(`Mesa ${numero} creada.`, null);
}
