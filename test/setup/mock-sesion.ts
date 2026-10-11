import { vi } from "vitest";
import type { UsuarioActual } from "../../src/server/sesion/session";

// Nota: `vi.mock` en sí va en cada test file (Vitest solo lo hoistea por
// archivo — ponerlo acá no garantiza que corra antes de otros imports).
// Este helper solo configura el valor de retorno una vez que el test file
// ya declaró su propio `vi.mock("../../src/server/sesion/session", ...)`.
export async function mockearUsuarioActual(usuario: UsuarioActual) {
  const { getUsuarioActual } = await import("../../src/server/sesion/session");
  vi.mocked(getUsuarioActual).mockResolvedValue(usuario);
}
