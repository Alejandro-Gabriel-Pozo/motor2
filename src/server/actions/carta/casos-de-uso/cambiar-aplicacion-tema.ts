import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { contarValoresTema } from "@/core/carta/public";
import type { ComandoCambiarAplicacionTema, ResultadoCambiarAplicacionTema } from "@/core/features/carta/tema.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarAplicacionDelTema } from "@/server/persistencia/carta/tema";

/**
 * Caso de uso «aplicar o desaplicar el tema de la carta» (docs/plan-tema-carta-2026-09-24.md, M8; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que
 * antes vivía en línea en la Server Action `cambiarAplicacionTema` (`src/server/actions/carta/tema.ts`), movido TAL CUAL. Aplicar exige que el tema exista y tenga al
 * menos un valor válido (no se aplica un tema vacío, D4). Si la sucursal no está en el portal (o no está publicada) se aplica igual y el texto avisa que no tiene efecto
 * hasta que la carta la conozca. Desaplicar es la vuelta atrás: la carta vuelve al estilo por defecto y los valores se conservan. La Server Action quedó como adaptador
 * (`conPermiso("carta_tema")` → `guardComandoCambiarAplicacionTema` → este caso de uso → `revalidarCartasPublicas` si salió bien, también en los avisos «sin efecto» →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que la sucursal sea la activa (el guard, antes de llegar acá).
 *
 * Orden, igual que antes: 1. que haya tema (`Esta sucursal todavía no tiene tema…`, tanto al aplicar como al desaplicar); 2. desaplicar escribe y termina; 3. aplicar
 * un tema vacío se rechaza (`No se puede aplicar un tema vacío…`) y, si no, escribe y arma el texto según el portal.
 *
 * @contract Deja el tema de la sucursal activa aplicado o desaplicado, con sus valores intactos; aplicar exige al menos un valor válido.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_tema transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function cambiarAplicacionTemaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoCambiarAplicacionTema): Promise<ResultadoCambiarAplicacionTema> {
  const { sucursalId, aplicar } = comando;
  const fila = await actor.db.temaCartaSucursal.findFirst({
    where: { sucursalId },
    select: { id: true, valores: true, sucursal: { select: { nombre: true, publica: { select: { publicada: true } } } } },
  });
  if (!fila) return fracaso("TEMA_NO_ENCONTRADO", "Esta sucursal todavía no tiene tema: guardalo primero.");
  const nombre = fila.sucursal.nombre;

  if (!aplicar) {
    await fijarAplicacionDelTema(actor.db, { id: fila.id, aplicarEnCarta: false });
    return exito(`Tema de "${nombre}" desaplicado: la carta vuelve al estilo por defecto (los valores guardados se conservan).`, null);
  }

  if (contarValoresTema(fila.valores) === 0) return fracaso("TEMA_VACIO", "No se puede aplicar un tema vacío: cargá al menos un valor y guardalo.");
  await fijarAplicacionDelTema(actor.db, { id: fila.id, aplicarEnCarta: true });
  const publica = fila.sucursal.publica;
  if (!publica) return exito(`Tema de "${nombre}" aplicado, pero sin efecto hasta agregarla al portal (Portal de sucursales).`, null);
  if (!publica.publicada) return exito(`Tema de "${nombre}" aplicado, pero sin efecto hasta publicarla en el portal.`, null);
  return exito(`Tema de "${nombre}" aplicado: la carta lo toma en hasta 5 minutos.`, null);
}
