import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { CambioDeMatriz } from "@/core/features/permisos/matriz.guard";
import { conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { claveEnCatalogo, type AccionClave } from "@/core/permisos/acciones";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import {
  esCeldaFueraDeNivel,
  MENSAJE_GUARDADO_EN_CONFLICTO,
  mismoEstado,
  nivelesDeLaCelda,
  normalizarPermiso,
  PREFIJO_CONFLICTO_DE_EDICION,
  SIN_PERMISO,
  type EstadoPermiso,
} from "@/core/permisos/matriz";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { escribirCeldaDeLaMatriz, leerCeldasDeLaMatriz } from "@/server/persistencia/permisos/matriz";

type ResultadoGuardarPermisos = ResultadoCaso<
  { guardados: number },
  "ROL_NO_ENCONTRADO" | "ACCION_NO_ENCONTRADA" | "FUERA_DE_NIVEL" | "SIN_CAMBIOS" | "CONFLICTO_DE_EDICION" | "GUARDADO_EN_CONFLICTO"
>;

/**
 * Caso de uso «guardar los cambios de la matriz de permisos» (Hito 3, Fase I, I.3 de `docs/plan-hito-3-pureza.md`). Guarda TODOS los cambios de la matriz de
 * una vez, o ninguno (modo edición con «Guardar»; decisión 6 de docs/grounding-lista-ver-editar-2026-09-18.md). Es el cuerpo que antes vivía en línea en la
 * Server Action `guardarPermisos` (`src/server/actions/permisos/permisos.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes (desde O35-C,
 * todas las lecturas van dentro de la transacción). La Server Action quedó como adaptador (`conEdicionDePermisos("gestion_permisos")` → `guardComandoGuardarPermisos`
 * → este caso de uso → `aResultadoAccion`). Escribe `PermisoRol` por `server/persistencia/permisos/matriz.ts`, y solo se lo llama dentro de
 * `conEdicionDePermisos` (contrato C5, modo ii de `escrituras-de-permisos-por-politica`).
 *
 * - «Ver ⊇ Editar» y la salvaguarda del admin (`normalizarPermiso`) se aplican acá, al escribir, igual que antes (Core.js:1513-1551). El piso de la acción
 *   manda: a un rol por debajo no se le puede dar (sacarle una fila que ya tenía sí). Anti-escalada: un admin no puede armar un rol operario con una acción de
 *   administrador, ni nadie un rol con una de gerente.
 * - Concurrencia: cada cambio trae lo que la persona VIO (`anterior`). Si en la base ya es otra cosa, alguien más la cambió mientras tanto: se rechaza el
 *   guardado ENTERO y se dice cuáles. Sin esto ganaba el último que guardaba, pisando en silencio el cambio de la otra persona.
 * - Una sola transacción: las escrituras y su registro de auditoría (A3, Pivote 6) salen juntos o no salen.
 * - Es SERIALIZABLE con reintento (`conTransaccionSerializable`), no READ COMMITTED. La comparación contra `anterior` es un chequeo optimista: en READ
 *   COMMITTED, dos guardados sobre la misma celda podían leer los dos el estado viejo, pasar los dos la comparación y aplicar los dos — ambos `ok: true`, el
 *   cambio de uno pisado en silencio, el aviso de conflicto sin dispararse y la auditoría del segundo con un `valorAnterior` falso. Bajo SERIALIZABLE el
 *   segundo aborta (40001), se reintenta, RELEE el estado nuevo y ahí devuelve «Otra persona cambió…»: el serializable no reemplaza al aviso, lo vuelve
 *   verídico. Como ese aviso se DEVUELVE (no se lanza), corta el reintento en el acto. Efecto colateral aceptado: `PermisoRol` es una tabla chica, así que dos
 *   guardados sobre celdas distintas también pueden chocar; el reintento lo absorbe (se edita unas pocas veces por semana, el costo es irrelevante).
 * - El rol y la acción se leen DENTRO de la transacción (O35-C de O.35; hasta ahí iban fuera, con `actor.db`), por id y por clave, y SIN `activo: true` en el
 *   `where`: si el rol está activo se mira en JS. Así lo que se valida (que el rol exista y esté activo, su clave para el piso y la salvaguarda, su nombre para
 *   los mensajes y la auditoría) es lo mismo que ve la escritura: si otra transacción desactiva el rol a la vez, una de las dos aborta (40001), se reintenta y
 *   la relectura da «¿está desactivado?». El filtro `activo: true` en el `where` es lo que se evita a propósito: tomaría un bloqueo de predicado sobre «todos
 *   los roles activos» y activar o desactivar CUALQUIER rol desde otra pantalla chocaría con un guardado de la matriz; leyendo solo las filas pedidas por su
 *   id, el choque queda acotado a esos roles (y el reintento lo absorbe). Reintentar el cuerpo es seguro: todo lo de adentro son lecturas y upserts
 *   idempotentes, y `efectivos` se recalcula en cada intento. El limitador de mutaciones se evalúa en `conPermiso*`, por fuera: un guardado que reintenta
 *   cuenta como uno.
 * - Agotar los reintentos de SERIALIZABLE (la transacción ya hizo rollback: no se guardó NADA) no es un error de la persona ni un 500: es «justo ahora había
 *   otro guardado en curso». Se devuelve como fracaso de negocio (`MENSAJE_GUARDADO_EN_CONFLICTO`) para que NO pierda el borrador — un `throw` lo mandaría al
 *   error boundary y se le borrarían todos los cambios marcados. Cualquier otro error sigue de largo.
 *
 * @contract Aplica todos los cambios pedidos de la matriz (con Ver ⊇ Editar, la salvaguarda del admin y el piso de cada acción) o ninguno, con dos registros de auditoría por celda.
 * @idempotency Optimista — cada cambio trae el estado que la persona vio (`anterior`); si la base ya es otra cosa (otro guardado, o el mismo repetido) se rechaza todo con «Otra persona cambió…».
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento); roles y acciones se leen adentro, por id y sin filtro de activo en el where (O35-C). Agotar los reintentos vuelve como fracaso GUARDADO_EN_CONFLICTO.
 * @sideEffects registrarCambioAuditado (PermisoRol.puedeEditar y PermisoRol.puedeVer por celda, con el valor anterior o null). Sin efectos externos.
 * @ficha permiso=gestion_permisos transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarPermisosCasoDeUso(actor: Pick<ContextoUsuario, "usuarioId" | "transaccion">, cambios: CambioDeMatriz[]): Promise<ResultadoGuardarPermisos> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoGuardarPermisos> => {
    // O35-C (O.35): el rol y la acción se leen DENTRO de la transacción, por id / clave y SIN `activo` en el `where` (si está activo se mira acá, en JS): lo que
    // se valida es lo mismo que se escribe, y no se toma un bloqueo de predicado sobre «todos los roles activos». Una a una (no en paralelo): es una transacción.
    const roles = await tx.rol.findMany({ where: { id: { in: cambios.map((c) => c.rolId) } } });
    const acciones = await tx.accion.findMany({ where: { clave: { in: cambios.map((c) => c.accionClave) } } });
    const rolPorId = new Map(roles.filter((r) => r.activo).map((r) => [r.id, r]));
    const accionesConocidas = new Set(acciones.map((a) => a.clave));

    // Lo que efectivamente se va a guardar (con Ver ⊇ Editar y la salvaguarda). Un cambio que no cambia nada, se ignora.
    const efectivos: { rolId: string; rolNombre: string; accionClave: AccionClave; anterior: EstadoPermiso; nuevo: EstadoPermiso }[] = [];
    for (const c of cambios) {
      const rol = rolPorId.get(c.rolId);
      if (!rol) return fracaso("ROL_NO_ENCONTRADO", "No se encontró uno de los roles (¿está desactivado?). No se guardó nada.");
      if (!claveEnCatalogo(c.accionClave) || !accionesConocidas.has(c.accionClave)) return fracaso("ACCION_NO_ENCONTRADA", `No se encontró la acción "${c.accionClave}". No se guardó nada.`);
      if ((c.nuevo.puedeVer || c.nuevo.puedeEditar) && esCeldaFueraDeNivel(rol, c.accionClave)) {
        const n = nivelesDeLaCelda(rol, c.accionClave)!;
        return fracaso("FUERA_DE_NIVEL", `El rol «${rol.nombre}» (nivel ${n.delRol}) no puede tener "${c.accionClave}": es una acción de nivel ${n.piso}. No se guardó nada.`);
      }
      const nuevo = normalizarPermiso(rol, c.accionClave, c.nuevo);
      if (mismoEstado(nuevo, c.anterior)) continue;
      efectivos.push({ rolId: rol.id, rolNombre: rol.nombre, accionClave: c.accionClave as AccionClave, anterior: c.anterior, nuevo });
    }
    if (!efectivos.length) return fracaso("SIN_CAMBIOS", "No hay cambios para guardar.");

    const actuales = await leerCeldasDeLaMatriz(tx, efectivos);
    const actualDe = new Map(actuales.map((a) => [`${a.rolId}:${a.accionClave}`, a]));

    const conflictos = efectivos.filter((e) => {
      const actual = actualDe.get(`${e.rolId}:${e.accionClave}`);
      return !mismoEstado(actual ? { puedeVer: actual.puedeVer, puedeEditar: actual.puedeEditar } : SIN_PERMISO, e.anterior);
    });
    if (conflictos.length) {
      const lista = conflictos.slice(0, 5).map((e) => `«${e.rolNombre}» · ${e.accionClave}`).join(", ");
      return fracaso(
        "CONFLICTO_DE_EDICION",
        `${PREFIJO_CONFLICTO_DE_EDICION} mientras editabas (${lista}${conflictos.length > 5 ? ` y ${conflictos.length - 5} más` : ""}). No se guardó nada: recargá la matriz y volvé a aplicar tus cambios.`
      );
    }

    for (const e of efectivos) {
      const existente = actualDe.get(`${e.rolId}:${e.accionClave}`);
      const fila = await escribirCeldaDeLaMatriz(tx, { rolId: e.rolId, accionClave: e.accionClave, puedeVer: e.nuevo.puedeVer, puedeEditar: e.nuevo.puedeEditar });
      await registrarCambioAuditado(tx, {
        entidad: "PermisoRol", entidadId: fila.id, campo: "puedeEditar",
        descripcion: `Permiso "${e.accionClave}" del rol "${e.rolNombre}": editar`,
        valorAnterior: existente?.puedeEditar ?? null, valorNuevo: e.nuevo.puedeEditar, actorId: actor.usuarioId,
      });
      await registrarCambioAuditado(tx, {
        entidad: "PermisoRol", entidadId: fila.id, campo: "puedeVer",
        descripcion: `Permiso "${e.accionClave}" del rol "${e.rolNombre}": ver`,
        valorAnterior: existente?.puedeVer ?? null, valorNuevo: e.nuevo.puedeVer, actorId: actor.usuarioId,
      });
    }
    return exito(`${efectivos.length} permiso(s) guardado(s).`, { guardados: efectivos.length });
  }).catch((e): ResultadoGuardarPermisos => {
    if (esConflictoDeEscritura(e)) return fracaso("GUARDADO_EN_CONFLICTO", MENSAJE_GUARDADO_EN_CONFLICTO);
    throw e;
  });
}
