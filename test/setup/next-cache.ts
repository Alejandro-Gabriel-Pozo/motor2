// Next 16.4 dejó de tolerar `revalidateTag`, `revalidatePath`, `updateTag` y `refresh` fuera de una petición real («Invariant: static generation store missing» y «refresh can only be called from within a Server Action»).
// Los tests importan los server actions y los llaman directo bajo Node/Vitest, sin petición: acá esas cuatro llamadas no hacen nada. En producción corren dentro de una Server Action y se comportan como siempre.
// Un test que quiera verificar que se llamaron lo hace con su propio `vi.mock("next/cache", …)`, que tiene prioridad sobre este. El resto de `next/cache` (por ejemplo `unstable_cache`) es el de verdad.
import { vi } from "vitest";

vi.mock("next/cache", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/cache")>();
  return {
    ...original,
    revalidateTag: () => {},
    revalidatePath: () => {},
    updateTag: () => {},
    refresh: () => {},
  };
});
