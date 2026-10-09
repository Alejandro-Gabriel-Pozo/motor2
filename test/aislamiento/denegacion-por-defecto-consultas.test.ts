import { vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «consultas de las páginas»: todo `src/server/consultas/**` (reportes, stock, POS, catálogo, carta, permisos; ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.consultas);
