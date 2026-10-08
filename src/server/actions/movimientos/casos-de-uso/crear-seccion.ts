import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCrearSeccion, ResultadoCrearSeccion } from "@/core/features/movimientos/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { crearSeccionNueva } from "@/server/persistencia/movimientos/secciones";

/**
 * Caso de uso «alta de una sección de stock en la sucursal activa» (port de HOJA_SECCIONES, Stock.js:1316-1415; Hito 4 de la pureza, bloque C de la pieza
 * carta/catálogo/stock, paso H4C-18 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `crearSeccion`
 * (`src/server/actions/movimientos/secciones.ts`), movido TAL CUAL: un nombre ya usado en ESTA sucursal (sin distinguir mayúsculas) se rechaza con el nombre tal
 * como se tipeó; si no, se crea con la base del contexto, sin transacción ni auditoría. La Server Action quedó como adaptador (`conPermiso("secciones")` →
 * `guardComandoCrearSeccion` → este caso de uso → si salió bien, refrescar la vista → `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Crea la sección en la sucursal activa, salvo que ya haya una con ese nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra la sección ya creada y se rechaza: no crea otra.
 * @transaction Ninguna: una lectura y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (una sección no es plata: sin auditoría). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=secciones transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearSeccionCasoDeUso(actor: Pick<ContextoUsuario, "db" | "sucursalId">, comando: ComandoCrearSeccion): Promise<ResultadoCrearSeccion> {
  const nombreLimpio = comando.nombre;
  const existente = await actor.db.seccion.findFirst({
    where: { sucursalId: actor.sucursalId, nombre: { equals: nombreLimpio, mode: "insensitive" } },
  });
  if (existente) {
    return fracaso("NOMBRE_REPETIDO", `Ya existe una sección "${nombreLimpio}" en esta sucursal (las secciones no distinguen mayúsculas/espacios).`);
  }

  const creada = await crearSeccionNueva(actor.db, { sucursalId: actor.sucursalId, nombre: nombreLimpio });
  return exito(`Sección "${creada.nombre}" creada.`, { id: creada.id, nombre: creada.nombre });
}
