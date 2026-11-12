// Interruptor de «Está bien así» (`ESTA_BIEN_ASI_VISIBLE`, `src/core/carta/esta-bien-asi.ts`; decisión del dueño 2026-11-11): en producción está APAGADO.
// Los tests existentes de la acción, la lista de pendientes y el aviso describen el comportamiento con el interruptor PRENDIDO (el de antes): acá se fija en `true` para que sigan siendo los mismos.
// La mitad APAGADO la fija `test/carta/esta-bien-asi-apagado.test.ts` con su propio `vi.mock` en `false` (tiene prioridad sobre este). Se carga desde `test/setup/next-cache.ts`.
import { vi } from "vitest";

vi.mock("../../src/core/carta/esta-bien-asi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/carta/esta-bien-asi")>()),
  ESTA_BIEN_ASI_VISIBLE: true,
}));
