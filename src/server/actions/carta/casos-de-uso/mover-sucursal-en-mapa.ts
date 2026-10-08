import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { validarPosicionPortal } from "@/core/carta/validaciones";
import type { ComandoMoverSucursalEnMapa, ResultadoMoverSucursalEnMapa } from "@/core/features/carta/registro-publico.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { moverRegistroPublicoEnMapa } from "@/server/persistencia/carta/registro-publico";

/**
 * Caso de uso «mover la tarjeta de una sucursal sobre el mapa del portal» (arrastrando en la vista previa de /carta/portal; docs/plan-registro-tenants-2026-09-24.md, M6;
 * Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action `moverSucursalEnMapa`
 * (`src/server/actions/carta/registro-publico.ts`), movido TAL CUAL: guarda SOLO `posX` y `posY` (% del mapa, 0 a 100, 2 decimales); el ancho y el alto quedan como estaban.
 * Exige que la sucursal ya tenga posición completa: arrastrar mueve, no ubica por primera vez (eso se hace con los números de su formulario, que además es la alternativa
 * sin arrastre). La Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_portal")` → `guardComandoMoverSucursalEnMapa` → este caso de uso →
 * `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que el id sea un texto (el guard). Sin más guard: la posición se valida DESPUÉS
 * de leer la fila, porque necesita el ancho y el alto que ya tiene.
 *
 * Orden, igual que antes: 1. que la sucursal esté en el portal (`Esta sucursal no está en el portal.`); 2. que tenga posición (`todavía no tiene posición en el mapa…`);
 * 3. que x e y sean válidas junto con el ancho y el alto actuales; 4. la escritura.
 *
 * @contract Deja la tarjeta de la sucursal en la posición (x, y) pedida, redondeada a 2 decimales, sin tocar el ancho ni el alto; devuelve el texto con los porcentajes.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos valores.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_portal transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function moverSucursalEnMapaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoMoverSucursalEnMapa): Promise<ResultadoMoverSucursalEnMapa> {
  const { sucursalId, x, y } = comando;
  const existente = await actor.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { id: true, posW: true, posH: true, sucursal: { select: { nombre: true } } } });
  if (!existente) return fracaso("NO_ESTA_EN_EL_PORTAL", "Esta sucursal no está en el portal.");
  if (existente.posW === null) return fracaso("SIN_POSICION", "Esta sucursal todavía no tiene posición en el mapa: cargala con los números de su formulario.");
  const posicion = validarPosicionPortal({ x, y, w: Number(existente.posW), h: existente.posH === null ? null : Number(existente.posH) });
  if (!posicion.ok) return fracaso("POSICION_INVALIDA", posicion.mensaje);
  await moverRegistroPublicoEnMapa(actor.db, { id: existente.id, posX: posicion.valor.x, posY: posicion.valor.y });
  return exito(`"${existente.sucursal.nombre}" movida a ${posicion.valor.x}% / ${posicion.valor.y}%.`, null);
}
