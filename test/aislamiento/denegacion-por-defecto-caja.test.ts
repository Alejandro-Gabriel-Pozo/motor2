import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «caja»: sesiones de caja, movimientos manuales, cobro y sus lecturas (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.caja);
