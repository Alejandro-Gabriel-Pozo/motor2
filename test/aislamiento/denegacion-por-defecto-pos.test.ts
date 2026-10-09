import { vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «POS»: mesas, cuentas, pedidos, anulaciones y cierre (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.pos);
