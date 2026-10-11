import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «stock y movimientos»: movimientos, compras, ventas, conteo, secciones, reclasificación, traspasos y consignación (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.stock);
