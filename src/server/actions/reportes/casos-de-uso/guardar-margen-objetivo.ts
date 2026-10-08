import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoGuardarMargenObjetivo, ResultadoGuardarMargenObjetivo } from "@/core/features/reportes/margen-objetivo.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { borrarMargenObjetivo, crearMargenObjetivo, fijarMargenObjetivo } from "@/server/persistencia/reportes/margen-objetivo";

/**
 * Caso de uso «fijar, cambiar o borrar el food cost objetivo de la empresa o de una categoría» (decisión del dueño, 2026-10-01; Hito 4 de la pureza, bloque C de la
 * pieza carta/catálogo/stock, paso H4C-16 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `guardarMargenObjetivo`
 * (`src/server/actions/reportes/margen-objetivo.ts`), movido TAL CUAL y en el MISMO orden, con la base del contexto para las lecturas: la categoría (si la hay;
 * «No se encontró la categoría.»), el objetivo que ya existía y su valor anterior. Si el valor pedido es el que ya había (o se borra lo que no estaba) responde ok
 * SIN escribir ni auditar (`huboCambio: false`); si no, en UNA transacción borra (valor vacío), cambia o crea la fila y deja UNA fila de auditoría (entidad
 * «MargenObjetivo», `entidadId` la categoría o `empresa`, `campo: "foodCostObjetivoPct"`, anterior → nuevo, sin sucursal). La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("margen_objetivo_editar")` → `guardComandoGuardarMargenObjetivo` → este caso de uso → si hubo cambio, refrescar la vista →
 * `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Deja el food cost objetivo de la empresa o de la categoría en el valor pedido (o sin objetivo propio), con su fila de auditoría si cambió.
 * @idempotency Por estado — repetir el pedido encuentra el mismo valor y responde ok sin escribir ni auditar.
 * @transaction Transacción simple (`actor.transaccion`): la escritura y su auditoría juntas. Las lecturas, antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (MargenObjetivo.foodCostObjetivoPct, del anterior al nuevo). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=margen_objetivo_editar transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarMargenObjetivoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoGuardarMargenObjetivo,
): Promise<ResultadoGuardarMargenObjetivo> {
  const { categoriaId, valor } = comando;

  let alcance = "la empresa";
  if (categoriaId !== null) {
    const categoria = await actor.db.categoriaProducto.findUnique({ where: { id: categoriaId }, select: { nombre: true } });
    if (!categoria) return fracaso("CATEGORIA_NO_ENCONTRADA", "No se encontró la categoría.");
    alcance = `la categoría «${categoria.nombre}»`;
  }

  const existente = await actor.db.margenObjetivo.findFirst({ where: { categoriaId } });
  const anterior = existente ? Number(existente.foodCostObjetivoPct) : null;
  if (valor === anterior) {
    return exito(
      valor === null ? `${capitalizar(alcance)} no tenía un food cost objetivo propio.` : `${capitalizar(alcance)} ya tenía ${valor} % de food cost objetivo.`,
      { huboCambio: false },
    );
  }

  await actor.transaccion(async (tx) => {
    if (valor === null) {
      await borrarMargenObjetivo(tx, { id: existente!.id });
    } else if (existente) {
      await fijarMargenObjetivo(tx, { id: existente.id, foodCostObjetivoPct: valor });
    } else {
      await crearMargenObjetivo(tx, { categoriaId, foodCostObjetivoPct: valor });
    }
    await registrarCambioAuditado(tx, {
      entidad: "MargenObjetivo",
      entidadId: categoriaId ?? "empresa",
      campo: "foodCostObjetivoPct",
      descripcion: `Food cost objetivo de ${alcance}`,
      valorAnterior: anterior,
      valorNuevo: valor,
      actorId: actor.usuarioId,
      sucursalId: null,
    });
  });
  return exito(valor === null ? `${capitalizar(alcance)} vuelve al objetivo que le corresponde por defecto.` : `Food cost objetivo de ${alcance}: ${valor} %.`, {
    huboCambio: true,
  });
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
