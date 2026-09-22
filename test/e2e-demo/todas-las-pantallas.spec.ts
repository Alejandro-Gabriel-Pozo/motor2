import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth-demo";
import { RUTAS_SIN_PARAMETROS } from "../e2e/rutas-sin-parametros";

/**
 * Barrido de TODAS las pantallas (misma lista que test/e2e/maquetacion-general.spec.ts) contra los datos REALES de 6 meses de
 * "La Cuadra" (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, tramo 5) — confirma que ninguna pantalla se rompe
 * (error boundary) ni viola axe cuando la carga de datos real de la demo (cientos de filas, avisos con datos de verdad,
 * "· parcial"/"· reconstruido", alertas de stock, conteos, una compra anulada, una corregida) la atraviesa entera.
 *
 * A diferencia de test/e2e/accesibilidad.spec.ts (que siembra el caso MÍNIMO necesario para auditar un componente puntual),
 * esto no siembra nada — usa lo que ya está.
 */
for (const ruta of RUTAS_SIN_PARAMETROS) {
  test(`${ruta}: abre sin error y sin violaciones de axe, con los datos reales de la demo`, async ({ paginaDemo: page }) => {
    await page.goto(ruta);
    await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" }), `${ruta} mostró la pantalla de error`).toHaveCount(0);

    const resultados = await new AxeBuilder({ page }).analyze();
    expect(resultados.violations, `${ruta}: ${resultados.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
  });
}
