import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarTemaCarta, ResultadoGuardarTemaCarta } from "@/core/features/carta/tema.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarValoresDelTema } from "@/server/persistencia/carta/tema";

/**
 * Caso de uso «guardar el tema visual de la carta de una sucursal» (docs/plan-tema-carta-2026-09-24.md, M8; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el
 * cuerpo que antes vivía en línea en la Server Action `guardarTemaCarta` (`src/server/actions/carta/tema.ts`), movido TAL CUAL: reemplaza TODO lo guardado por los
 * valores que llegan (el formulario manda las 64 claves) con un `upsert` por `(empresaId, sucursalId)`; al crear la fila no toca `aplicarEnCarta` (queda en borrador) y
 * al editar un tema ya aplicado sigue aplicado. La Server Action quedó como adaptador (`conPermiso("carta_tema")` → `guardComandoGuardarTemaCarta` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato, ni que la sucursal sea la activa (el guard, antes de llegar acá).
 * Guardar y aplicar son acciones separadas (D4): un tema guardado sin aplicar es un borrador y la carta usa el estilo por defecto.
 *
 * @contract Deja el tema de la sucursal con exactamente los valores pedidos, sin tocar si está aplicado; devuelve cuántos valores quedaron y si está aplicado.
 * @idempotency Por estado — es un `upsert` por sucursal: repetir el pedido deja la misma fila.
 * @transaction Ninguna: una lectura de la sucursal y un `upsert` con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_tema transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarTemaCartaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoGuardarTemaCarta): Promise<ResultadoGuardarTemaCarta> {
  const { sucursalId, valores } = comando;
  const sucursal = await actor.db.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true, nombre: true } });
  if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");

  const fila = await guardarValoresDelTema(actor.db, { empresaId: sucursal.empresaId, sucursalId, valores });
  const cantidad = Object.keys(valores).length;
  const estado = fila.aplicarEnCarta ? "Está aplicado: la carta toma los cambios en hasta 5 minutos." : "Es un borrador: la carta usa el estilo por defecto hasta que lo apliques.";
  return exito(`Tema de "${sucursal.nombre}" guardado (${cantidad} ${cantidad === 1 ? "valor cargado" : "valores cargados"}; el resto usa el default de la carta). ${estado}`, {
    cantidad,
    aplicadoEnCarta: fila.aplicarEnCarta,
  });
}
