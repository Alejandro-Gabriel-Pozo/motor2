import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoRenombrarOFusionarInsumo, ResultadoRenombrarOFusionarInsumo } from "@/core/features/catalogo/insumos.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { validarFusionInsumos } from "@/server/lecturas/catalogo/unidad-de-insumo";
import { borrarInsumo, reapuntarSustitutosDeInsumoFusionado, reasignarProductosDeInsumo, renombrarInsumo } from "@/server/persistencia/catalogo/insumos";

/** «1 producto reasignado» / «N productos reasignados», para la descripción de la fila de auditoría de una fusión. */
const productosReasignados = (cantidad: number): string => (cantidad === 1 ? "1 producto reasignado" : `${cantidad} productos reasignados`);

/**
 * Caso de uso «renombrar un insumo, o fusionarlo con otro» (equivalente de renombrarFamilia, Catalogo.js:2565-2618; Hito 4 de la pureza, bloque 4.3: mudado TAL
 * CUAL en H4C-9 desde la Server Action `renombrarOFusionarInsumo` de `src/server/actions/catalogo/insumos.ts`, y auditado en H4C-10 — D-9, ver abajo).
 *
 * Mucho más simple que en Sheets: como Producto.insumoId es FK real (no texto duplicado en Hoja listado), fusionar es un UPDATE ... WHERE insumoId, no un "buscar
 * y reemplazar" fila por fila. Nunca toca Receta/Kardex — Insumo nunca viajó a esas hojas (Catalogo.js:2557-2559). Cuando el nombre nuevo matchea un insumo
 * existente, esto FUSIONA (mueve todos los productos y borra el insumo viejo) en vez de solo renombrar — por eso exige `confirmarFusion === true` explícito (ver
 * `previsualizarFusionInsumo` y `validarFusionInsumos`, que además bloquea fusionar unidades de stock mezcladas bajo el mismo Insumo). El insumo actual, el que
 * ya tiene ese nombre y el choque de unidades se leen con la base del contexto, en ese orden. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("insumo_renombrar_fusionar")` → `guardComandoRenombrarOFusionarInsumo` → este caso de uso → `aResultadoAccion`).
 *
 * D-9 (decisión del dueño, 2026-10-07; H4C-10, commit aparte — CAMBIÓ COMPORTAMIENTO): las dos ramas se auditan en la MISMA transacción que el cambio. La fusión
 * (productos, sustitutos de receta, borrado del origen) deja UNA fila sobre el insumo que desaparece (`campo: "fusion"`, del nombre de origen al de destino, con
 * la cantidad de productos reasignados en la descripción). El renombre, que antes era una sola escritura SIN transacción, ahora va en una transacción SIMPLE
 * con su fila (`campo: "nombre"`, del anterior al nuevo; renombrar al mismo nombre no deja fila: `registrarCambioAuditado` no registra lo que no cambió).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del nombre (el guard).
 *
 * @contract Renombra el insumo, o, si el nombre ya es de otro y vino la confirmación, mueve sus productos y sus usos como sustituto al otro y lo borra; cada rama con su fila de auditoría, todo o nada.
 * @idempotency Por estado — repetir una fusión ya hecha se rechaza («No se encontró el insumo.»: el origen ya no existe); repetir un renombre vuelve a escribir el mismo nombre, sin fila nueva.
 * @transaction `actor.transaccion` (READ COMMITTED) en las dos ramas: la fusión y su fila, o el renombre y su fila.
 * @sideEffects registrarCambioAuditado (Insumo.nombre en el renombre; Insumo.fusion en la fusión, sobre el insumo borrado), en la misma transacción.
 * @ficha permiso=insumo_renombrar_fusionar transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function renombrarOFusionarInsumoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoRenombrarOFusionarInsumo,
): Promise<ResultadoRenombrarOFusionarInsumo> {
  const { insumoId, nombre: nuevo, confirmarFusion } = comando;
  const actual = await actor.db.insumo.findUnique({ where: { id: insumoId } });
  if (!actual) return fracaso("INSUMO_NO_ENCONTRADO", "No se encontró el insumo.");

  const existente = await actor.db.insumo.findFirst({
    where: { nombre: { equals: nuevo, mode: "insensitive" }, id: { not: insumoId } },
  });

  if (existente) {
    const chocaUnidad = await validarFusionInsumos(insumoId, existente.id, actor.db);
    if (chocaUnidad) return fracaso("UNIDAD_MEZCLADA", chocaUnidad);

    // `=== true`, no truthy: el argumento llega del navegador, y un "false" o un 1 no es una confirmación.
    if (confirmarFusion !== true) {
      return fracaso("FALTA_CONFIRMAR", `Ya existe el insumo "${existente.nombre}" — hace falta confirmar la fusión antes de aplicarla.`);
    }

    await actor.transaccion(async (tx) => {
      const reasignados = await reasignarProductosDeInsumo(tx, { origenId: insumoId, destinoId: existente.id });
      await reapuntarSustitutosDeInsumoFusionado(tx, insumoId, existente.id);
      // DESPUÉS de reapuntar los sustitutos (FK RESTRICT: docs/plan-sustitucion-insumos-receta-2026-09-26.md, D9) — sin esto, la
      // fusión de un Insumo usado como sustituto en alguna receta fallaba por la FK en vez de arrastrarlo como corresponde.
      await borrarInsumo(tx, { id: insumoId });
      // D-9: el rastro de la fusión, sobre el insumo que desaparece (su id queda en la fila aunque la fila del insumo ya no exista).
      await registrarCambioAuditado(tx, {
        entidad: "Insumo",
        entidadId: insumoId,
        campo: "fusion",
        descripcion: `Insumo "${actual.nombre}" fusionado con "${existente.nombre}" (${productosReasignados(reasignados)})`,
        valorAnterior: actual.nombre,
        valorNuevo: existente.nombre,
        actorId: actor.usuarioId,
      });
    });
    return exito(`"${actual.nombre}" se fusionó con el insumo existente "${existente.nombre}".`, null);
  }

  // D-9: el renombre y su rastro, en UNA transacción (antes era una sola escritura con la base del contexto, sin auditoría).
  await actor.transaccion(async (tx) => {
    await renombrarInsumo(tx, { id: insumoId, nombre: nuevo });
    await registrarCambioAuditado(tx, {
      entidad: "Insumo",
      entidadId: insumoId,
      campo: "nombre",
      descripcion: `Insumo "${actual.nombre}": nombre`,
      valorAnterior: actual.nombre,
      valorNuevo: nuevo,
      actorId: actor.usuarioId,
    });
  });
  return exito(`Insumo renombrado a "${nuevo}".`, null);
}
