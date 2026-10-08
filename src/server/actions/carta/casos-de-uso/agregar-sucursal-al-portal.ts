import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { slugTenant, slugTenantUnico } from "@/core/carta/registro-tenants";
import type { ComandoAgregarSucursalAlPortal, ResultadoAgregarSucursalAlPortal } from "@/core/features/carta/registro-publico.schema";
import { esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { crearRegistroPublicoDeSucursal } from "@/server/persistencia/carta/registro-publico";

const MAXIMO_INTENTOS_SLUG = 5;

/**
 * Caso de uso «agregar la sucursal al registro del portal» (docs/plan-registro-tenants-2026-09-24.md, M6; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el
 * cuerpo que antes vivía en línea en la Server Action `agregarSucursalAlPortal` (`src/server/actions/carta/registro-publico.ts`), movido TAL CUAL: las mismas lecturas con
 * la base del contexto (sin transacción), el mismo orden de chequeos, los mismos mensajes y el mismo bucle de reintentos. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("carta_portal")` → `guardComandoAgregarSucursalAlPortal` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que el id sea un texto (el guard). Alta opt-in (D3): crea la fila SIN publicar, con
 * el slug calculado desde el nombre (`slugTenant`) y desambiguado contra TODOS los que ya existen (`-2`, `-3`…); si hace falta otra dirección, el slug se edita después a mano.
 *
 * Orden, igual que antes: 1. la sucursal (`No se encontró la sucursal.`); 2. hasta 5 intentos, y en cada uno: que no esté ya en el portal (`"<nombre>" ya está en el portal
 * (slug <slug>).`), se lee el conjunto de slugs ocupados, se calcula el slug y se escribe. Ante una carrera con otra alta que tomó el mismo slug (error de unicidad) se vuelve
 * a empezar el intento (se recalculan los ocupados); un error que no es de unicidad se propaga. Agotados los 5: `Otra carga simultánea tomó el mismo slug. Volvé a intentar.`
 *
 * @contract Deja la sucursal en el registro del portal con un slug único de la empresa y sin publicar, salvo que ya estuviera o se agoten los intentos; devuelve el slug.
 * @idempotency Por estado — repetir el pedido encuentra la fila ya creada y se rechaza con «ya está en el portal».
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes (el reintento es por el error de unicidad, no por una transacción).
 * @sideEffects Ninguno (el registro del portal no es plata: sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_portal transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarSucursalAlPortalCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoAgregarSucursalAlPortal): Promise<ResultadoAgregarSucursalAlPortal> {
  const { sucursalId } = comando;
  const sucursal = await actor.db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true } });
  if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", "No se encontró la sucursal.");

  for (let intento = 0; intento < MAXIMO_INTENTOS_SLUG; intento++) {
    const yaEsta = await actor.db.sucursalPublica.findFirst({ where: { sucursalId }, select: { slug: true } });
    if (yaEsta) return fracaso("YA_EN_EL_PORTAL", `"${sucursal.nombre}" ya está en el portal (slug ${yaEsta.slug}).`);

    const ocupados = new Set((await actor.db.sucursalPublica.findMany({ select: { slug: true } })).map((f) => f.slug));
    const slug = slugTenantUnico(slugTenant(sucursal.nombre), ocupados);
    try {
      await crearRegistroPublicoDeSucursal(actor.db, { sucursalId, slug });
      return exito(`"${sucursal.nombre}" agregada al portal con el slug ${slug} (sin publicar todavía).`, { slug });
    } catch (e) {
      if (!esChoqueDeIndiceUnico(e)) throw e;
    }
  }
  return fracaso("SLUG_TOMADO", "Otra carga simultánea tomó el mismo slug. Volvé a intentar.");
}
