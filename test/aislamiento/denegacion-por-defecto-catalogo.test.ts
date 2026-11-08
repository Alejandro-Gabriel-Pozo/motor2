import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La matriz de denegación ejerce TODAS las acciones del catálogo contra una empresa ajena, presentaciones incluidas: corre con el interruptor de las presentaciones ENCENDIDO (`PRESENTACIONES_VISIBLES`, decisión del dueño 2026-11-06),
// así sigue probando el aislamiento de esas acciones. Apagado, rechazan antes de tocar datos (`presentaciones-interruptor.test.ts`).
vi.mock("../../src/core/catalogo/presentaciones-visibles", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/presentaciones-visibles")>()), PRESENTACIONES_VISIBLES: true }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «catálogo»: productos, insumos, proveedores, recetas, unidades y categorías (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.catalogo);
