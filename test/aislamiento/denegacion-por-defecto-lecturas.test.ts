import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «lecturas de los casos de uso»: todo `src/server/lecturas/**` (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.lecturas);
