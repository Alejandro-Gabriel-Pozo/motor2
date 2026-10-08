import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoRenombrarOFusionarInsumo, ResultadoRenombrarOFusionarInsumo } from "@/core/features/catalogo/insumos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { validarFusionInsumos } from "@/server/lecturas/catalogo/unidad-de-insumo";
import { borrarInsumo, reapuntarSustitutosDeInsumoFusionado, reasignarProductosDeInsumo, renombrarInsumo } from "@/server/persistencia/catalogo/insumos";

/**
 * Caso de uso «renombrar un insumo, o fusionarlo con otro» (equivalente de renombrarFamilia, Catalogo.js:2565-2618; Hito 4 de la pureza, bloque 4.3, paso H4C-9
 * — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `renombrarOFusionarInsumo` (`src/server/actions/catalogo/insumos.ts`),
 * movido TAL CUAL (mudanza pura: sigue SIN auditoría y el renombre sigue SIN transacción; eso lo cambia D-9, en su propio commit):
 *
 * Mucho más simple que en Sheets: como Producto.insumoId es FK real (no texto duplicado en Hoja listado), fusionar es un UPDATE ... WHERE insumoId, no un "buscar
 * y reemplazar" fila por fila. Nunca toca Receta/Kardex — Insumo nunca viajó a esas hojas (Catalogo.js:2557-2559). Cuando el nombre nuevo matchea un insumo
 * existente, esto FUSIONA (mueve todos los productos y borra el insumo viejo) en vez de solo renombrar — por eso exige `confirmarFusion === true` explícito (ver
 * `previsualizarFusionInsumo` y `validarFusionInsumos`, que además bloquea fusionar unidades de stock mezcladas bajo el mismo Insumo). El insumo actual, el que
 * ya tiene ese nombre y el choque de unidades se leen con la base del contexto, en ese orden; la fusión (productos, sustitutos de receta y el borrado del origen)
 * va en UNA transacción, y el renombre es una sola escritura con la base del contexto. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("insumo_renombrar_fusionar")` → `guardComandoRenombrarOFusionarInsumo` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del nombre (el guard).
 *
 * @contract Renombra el insumo, o, si el nombre ya es de otro y vino la confirmación, mueve sus productos y sus usos como sustituto al otro y lo borra (la fusión, todo o nada).
 * @idempotency Por estado — repetir una fusión ya hecha se rechaza («No se encontró el insumo.»: el origen ya no existe); repetir un renombre vuelve a escribir el mismo nombre.
 * @transaction `actor.transaccion` (READ COMMITTED) para la fusión; el renombre es una sola escritura con `actor.db`, sin transacción (como antes).
 * @sideEffects Ninguno (sin auditoría hasta D-9).
 * @ficha permiso=insumo_renombrar_fusionar transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function renombrarOFusionarInsumoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion">,
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
      await reasignarProductosDeInsumo(tx, { origenId: insumoId, destinoId: existente.id });
      await reapuntarSustitutosDeInsumoFusionado(tx, insumoId, existente.id);
      // DESPUÉS de reapuntar los sustitutos (FK RESTRICT: docs/plan-sustitucion-insumos-receta-2026-09-26.md, D9) — sin esto, la
      // fusión de un Insumo usado como sustituto en alguna receta fallaba por la FK en vez de arrastrarlo como corresponde.
      await borrarInsumo(tx, { id: insumoId });
    });
    return exito(`"${actual.nombre}" se fusionó con el insumo existente "${existente.nombre}".`, null);
  }

  await renombrarInsumo(actor.db, { id: insumoId, nombre: nuevo });
  return exito(`Insumo renombrado a "${nuevo}".`, null);
}
