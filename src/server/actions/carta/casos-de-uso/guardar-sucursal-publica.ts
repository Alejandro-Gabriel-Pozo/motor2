import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarSucursalPublica, ResultadoGuardarSucursalPublica } from "@/core/features/carta/registro-publico.schema";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarRegistroPublicoDeSucursal } from "@/server/persistencia/carta/registro-publico";

/**
 * Caso de uso «guardar el registro público de una sucursal que ya está en el portal» (docs/plan-registro-tenants-2026-09-24.md, M6; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action `guardarSucursalPublica` (`src/server/actions/carta/registro-publico.ts`),
 * movido TAL CUAL: las mismas lecturas con la base del contexto (sin transacción), el mismo orden de chequeos y los mismos mensajes. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("carta_portal")` → `guardComandoGuardarSucursalPublica` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * Orden, igual que antes: 1. que la sucursal ya esté en el portal (`Esta sucursal no está en el portal: agregala primero.`); 2. que otra sucursal no use ese slug
 * (`El slug <slug> ya lo usa "<nombre>".`; guardar la propia fila con su mismo slug no es un choque); 3. la escritura, con el `catch` de la carrera (otra sucursal tomó el
 * slug entre el chequeo y la escritura: el índice único; un error que no es de unicidad se propaga).
 *
 * @contract Deja el registro público de la sucursal con los datos pedidos (y publicado o no), salvo que no esté en el portal o que otra sucursal use el slug.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos valores sobre la misma fila.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (el registro del portal no es plata: sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_portal transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarSucursalPublicaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoGuardarSucursalPublica): Promise<ResultadoGuardarSucursalPublica> {
  const { sucursalId, slug, posicion } = comando;
  const existente = await actor.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { id: true, sucursal: { select: { nombre: true } } } });
  if (!existente) return fracaso("NO_ESTA_EN_EL_PORTAL", "Esta sucursal no está en el portal: agregala primero.");

  const conMismoSlug = await actor.db.sucursalPublica.findFirst({ where: { slug, NOT: { sucursalId } }, select: { sucursal: { select: { nombre: true } } } });
  if (conMismoSlug) return fracaso("SLUG_EN_USO", `El slug ${slug} ya lo usa "${conMismoSlug.sucursal.nombre}".`);

  try {
    await guardarRegistroPublicoDeSucursal(actor.db, {
      id: existente.id,
      datos: {
        slug,
        etiqueta: comando.etiqueta,
        subtituloPortal: comando.subtituloPortal,
        posX: posicion.x,
        posY: posicion.y,
        posW: posicion.w,
        posH: posicion.h,
        orden: comando.orden,
        publicada: comando.publicada,
      },
    });
  } catch (e) {
    if (esChoqueDeIndiceUnico(e)) return fracaso("SLUG_TOMADO", "Otra sucursal tomó ese slug mientras guardabas. Revisalo y volvé a intentar.");
    throw e;
  }
  return exito(`Portal: "${existente.sucursal.nombre}" guardada${comando.publicada ? " y publicada" : " (sin publicar)"}.`, null);
}
