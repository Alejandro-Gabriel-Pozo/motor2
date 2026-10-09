import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarSeccionCarta, ResultadoGuardarSeccionCarta } from "@/core/features/carta/secciones.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarDatosDeSeccionCarta, crearSeccionDeCarta } from "@/server/persistencia/carta/secciones";

/**
 * Caso de uso «alta o edición de una sección de la carta» (docs/plan-carta-catalogo-2026-09-24.md, M9; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo
 * que antes vivía en línea en la Server Action `guardarSeccionCarta` (`src/server/actions/carta/secciones.ts`), movido TAL CUAL: las mismas lecturas con la base del
 * contexto (sin transacción), el mismo orden de chequeos y los mismos mensajes. La Server Action quedó como adaptador (`conPermisoDeEmpresa("carta_secciones")` →
 * `guardComandoGuardarSeccionCarta` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). Las secciones son de la EMPRESA (D4): el nombre no se
 * puede repetir en toda la empresa, sin distinguir mayúsculas.
 *
 * Orden, igual que antes: 1. otra sección con ese nombre (en la edición, sin contar la propia) → `Ya existe la sección de carta "<la guardada>".`, aunque el id a editar
 * no exista; 2. con `id`: que la sección exista (`No se encontró la sección de carta.`) y se cambian sus cinco campos; sin `id`: se crea.
 *
 * @contract Deja la sección con los datos pedidos (creada o editada), salvo que otra de la empresa ya tenga ese nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el alta encuentra la sección ya creada y se rechaza por nombre repetido; repetir la edición vuelve a escribir los mismos valores.
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (una sección no es plata: sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_secciones transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarSeccionCartaCasoDeUso(actor: Pick<ContextoUsuario, "db">, comando: ComandoGuardarSeccionCarta): Promise<ResultadoGuardarSeccionCarta> {
  const repetida = await actor.db.seccionCarta.findFirst({
    where: { nombre: { equals: comando.nombre, mode: "insensitive" }, ...(comando.id ? { NOT: { id: comando.id } } : {}) },
  });
  if (repetida) return fracaso("NOMBRE_REPETIDO", `Ya existe la sección de carta "${repetida.nombre}".`);

  const data = { nombre: comando.nombre, titulo: comando.titulo, descripcion: comando.descripcion, imagenUrl: comando.imagenUrl, orden: comando.orden };
  if (comando.id) {
    const existente = await actor.db.seccionCarta.findUnique({ where: { id: comando.id } });
    if (!existente) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");
    const s = await cambiarDatosDeSeccionCarta(actor.db, { id: comando.id, ...data });
    return exito(`Sección de carta "${s.nombre}" guardada.`, s);
  }
  const s = await crearSeccionDeCarta(actor.db, data);
  return exito(`Sección de carta "${s.nombre}" creada.`, s);
}
