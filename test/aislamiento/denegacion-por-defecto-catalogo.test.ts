import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «catálogo»: productos, insumos, proveedores, recetas, unidades y categorías (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.catalogo);
