import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import type { ComandoGuardarGeneroCarta, ResultadoGuardarGeneroCarta } from "@/core/features/carta/generos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarDatosDeGeneroCarta, crearGeneroDeCarta } from "@/server/persistencia/carta/generos";

/**
 * Caso de uso «alta o edición de un género de la carta» (docs/plan-genero-carta-2026-09-26.md; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que
 * antes vivía en línea en la Server Action `guardarGeneroCarta` (`src/server/actions/carta/generos.ts`), movido TAL CUAL: las mismas lecturas con la base del contexto
 * (sin transacción), el mismo orden de chequeos y los mismos mensajes. La Server Action quedó como adaptador (`conPermiso("carta_generos")` →
 * `guardComandoGuardarGeneroCarta` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). Los géneros son PROPIOS de cada sucursal (ADR-009, C3):
 * el nombre repetido y la edición miran solo la sucursal activa (`whereCartaDeSucursal`), y se crean siempre en ella.
 *
 * Orden, igual que antes: 1. otro género de la sucursal con ese nombre (en la edición, sin contar el propio) → `Ya existe el género "<el guardado>".`, aunque el id a
 * editar no exista; 2. con `id`: que el género exista en la sucursal (`No se encontró el género.`) y se cambian nombre y orden; sin `id`: se crea.
 *
 * @contract Deja el género con el nombre y el orden pedidos (creado o editado) en la sucursal activa, salvo que otro de ella ya tenga ese nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el alta encuentra el género ya creado y se rechaza por nombre repetido; repetir la edición vuelve a escribir los mismos valores.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (una carpeta visual no es plata: sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_generos transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarGeneroCartaCasoDeUso(actor: Pick<ContextoUsuario, "db" | "sucursalId">, comando: ComandoGuardarGeneroCarta): Promise<ResultadoGuardarGeneroCarta> {
  const repetido = await actor.db.generoCarta.findFirst({
    where: { nombre: { equals: comando.nombre, mode: "insensitive" }, ...whereCartaDeSucursal(actor.sucursalId), ...(comando.id ? { NOT: { id: comando.id } } : {}) },
  });
  if (repetido) return fracaso("NOMBRE_REPETIDO", `Ya existe el género "${repetido.nombre}".`);

  const data = { nombre: comando.nombre, orden: comando.orden };
  if (comando.id) {
    const existente = await actor.db.generoCarta.findUnique({ where: { id: comando.id, ...whereCartaDeSucursal(actor.sucursalId) } });
    if (!existente) return fracaso("GENERO_NO_ENCONTRADO", "No se encontró el género.");
    const g = await cambiarDatosDeGeneroCarta(actor.db, { id: comando.id, ...data });
    return exito(`Género "${g.nombre}" guardado.`, g);
  }
  const g = await crearGeneroDeCarta(actor.db, { sucursalId: actor.sucursalId, ...data });
  return exito(`Género "${g.nombre}" creado.`, g);
}
