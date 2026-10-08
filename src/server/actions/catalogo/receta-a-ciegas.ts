import "server-only";
import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "@/core/catalogo/public";
import { guardComandoGuardarVersionDeReceta } from "@/core/features/catalogo/receta-version.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { guardarVersionDeRecetaCasoDeUso } from "./casos-de-uso/guardar-version-de-receta";

/**
 * Reemplazo completo de la receta central «A CIEGAS», sin versión esperada (O.1 de `docs/pureza-integracion.md`, Revisión #93 (3); Hito 4, bloque C, paso H4C-23 —
 * autorizado por el dueño, `docs/plan-hito-4-pureza.md` §1). Es lo que hacía la Server Action `guardarReceta` cuando no recibía la versión: guarda una versión nueva
 * sobre LO QUE HAYA (si otra persona guardó en el medio, su cambio queda debajo, sin aviso). Eso solo tiene sentido para quien carga recetas en bloque sin haber leído
 * nada antes: los seeds de demo (`scripts/seed-demo-pizzeria*.ts`) y los tests. Por eso vive acá y NO en `recetas.ts`:
 *  - `import "server-only"` y SIN `"use server"`: no es un endpoint, el navegador no la puede invocar (la acción pública `guardarReceta` exige la versión);
 *  - el guardián `receta-a-ciegas-solo-desde-scripts-y-tests` fija que ningún archivo de `src/` la importe (solo `scripts/` y `test/`).
 *
 * Mismo camino que la acción pública, sin atajos: permiso (`conPermisoDeEmpresa("guardar_receta")`) → formato (`guardComandoGuardarVersionDeReceta` con la versión
 * `null` = a ciegas) → caso de uso (`casos-de-uso/guardar-version-de-receta.ts`: validación, versionado con reintento, transacción SERIALIZABLE, arrastre de
 * calibraciones y auditoría) → refrescar la vista si salió bien → `aResultadoAccion`.
 */
export async function guardarRecetaACiegas(productoId: string, items: IngredienteInput[], pasos: PasoInput[] = [], cabecera: CabeceraRecetaInput = {}): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("guardar_receta", async (ctx) => {
    const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos, cabecera, versionEsperada: null });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, comando.valor);
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
