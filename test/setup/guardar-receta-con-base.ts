import type { IngredienteInput } from "../../src/core/catalogo/public";
import type { BaseDeCantidad } from "../../src/core/catalogo/public";
import { guardComandoGuardarVersionDeReceta } from "../../src/core/features/catalogo/receta-version.guard";
import { aResultadoAccion } from "../../src/core/resultado-caso";
import { conPermisoDeEmpresa } from "../../src/server/actions/con-permiso";
import { guardarVersionDeRecetaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta";
import { error, type ResultadoAccion } from "../../src/server/actions/tipos";

/**
 * Guarda una versión central de la receta ESCRIBIENDO la marca de base que se pida (M3d): hasta que exista M3b (la carga en bruto), ningún camino de la aplicación escribe BRUTA, y la
 * prueba del arrastre de calibraciones necesita una versión nueva en otra base que la anterior. Mismo camino que `guardarRecetaACiegas` (permiso, guard, caso de uso, SERIALIZABLE, arrastre,
 * auditoría), pasando solo `baseDeCantidad` en el destino. Solo para tests.
 */
export async function guardarRecetaConBase(productoId: string, items: IngredienteInput[], base: BaseDeCantidad, versionEsperada: number | null = null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("guardar_receta", async (ctx) => {
    const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos: [], cabecera: {}, versionEsperada });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, { ...comando.valor, omitirGuardiaDeUnidad: true }, { sucursalId: null, baseDeCantidad: base });
    return aResultadoAccion(resultado);
  });
}
