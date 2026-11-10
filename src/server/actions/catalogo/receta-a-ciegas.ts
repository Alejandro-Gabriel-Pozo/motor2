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
 * autorizado por el dueño, `docs/plan-hito-4-pureza.md` §1). Es lo que hacía la Server Action `guardarReceta` cuando no recibía la versión (esa acción pública se retiró el 2026-11-06: nadie en pantalla la usaba, solo tests y seeds): guarda una versión nueva
 * sobre LO QUE HAYA (si otra persona guardó en el medio, su cambio queda debajo, sin aviso). Eso solo tiene sentido para quien carga recetas en bloque sin haber leído
 * nada antes: los seeds de demo (`scripts/seed-demo-pizzeria*.ts`) y los tests. Por eso vive acá y NO en `recetas.ts`:
 *  - `import "server-only"` y SIN `"use server"`: no es un endpoint, el navegador no la puede invocar (la pantalla guarda con las acciones de a un ingrediente o paso de `recetas.ts`, que exigen la versión que vio);
 *  - el guardián `receta-a-ciegas-solo-desde-scripts-y-tests` fija que ningún archivo de `src/` la importe (solo `scripts/` y `test/`).
 *
 * `versionEsperada` (opcional, `null` = a ciegas): con un entero ≥ 0 se rechaza si la receta ya va por otra versión (los tests de versión esperada lo usan). Mismo camino que las acciones públicas, sin atajos: permiso (`conPermisoDeEmpresa("guardar_receta")`) → formato (`guardComandoGuardarVersionDeReceta` con la versión
 * `null` = a ciegas) → caso de uso (`casos-de-uso/guardar-version-de-receta.ts`: validación, versionado con reintento, transacción SERIALIZABLE, arrastre de
 * calibraciones y auditoría) → refrescar la vista si salió bien → `aResultadoAccion`.
 */
export async function guardarRecetaACiegas(productoId: string, items: IngredienteInput[], pasos: PasoInput[] = [], cabecera: CabeceraRecetaInput = {}, versionEsperada: number | null = null): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("guardar_receta", async (ctx) => {
    const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos, cabecera, versionEsperada });
    if (!comando.ok) return error(comando.mensaje);
    // Guardia de unidad (docs/diseno-guardia-de-unidad-receta-2026-11-09.md, R5): la carga en bloque (seeds, scripts, tests) no pasa por ella — no hay pantalla donde confirmar.
    const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, { ...comando.valor, omitirGuardiaDeUnidad: true });
    if (resultado.ok) refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}
