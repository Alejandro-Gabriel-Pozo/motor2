import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «gobierno»: sesión, usuarios, sucursales, roles, permisos, capacidades y clientes (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.gobierno);
