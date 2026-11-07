// (Se carga desde `test/setup/next-cache.ts`, el archivo de setup que ya registra `vitest.config.ts`: ese archivo es del mecanismo de gobierno y no se toca.)
// Interruptor de género de carta e ítem agrupado (`GENERO_E_ITEM_AGRUPADO_VISIBLE`, `src/core/carta/genero-e-item-agrupado.ts`; decisión del dueño 2026-11-06): en producción está APAGADO.
// Los tests existentes de géneros, ítems agrupados y de todo lo que los lee describen el comportamiento con el interruptor PRENDIDO (el de antes de la poda): acá se fija en `true` para que sigan siendo
// los mismos, sin tocarlos. Es la mitad "encendido" de la reversibilidad. La mitad APAGADO (lo que se ve hoy en producción) la fijan los tests que lo apagan a propósito con su propio
// `vi.mock("…/genero-e-item-agrupado", …)` en `false` (tiene prioridad sobre este): `test/carta/genero-e-item-agrupado-apagado.test.ts` y `…-combinaciones.test.ts`.
import { vi } from "vitest";

vi.mock("../../src/core/carta/genero-e-item-agrupado", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/carta/genero-e-item-agrupado")>()),
  GENERO_E_ITEM_AGRUPADO_VISIBLE: true,
}));
