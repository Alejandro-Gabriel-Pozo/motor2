import { vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// La matriz ejerce el menú del día ENCENDIDO (el estado con más superficie: con el interruptor apagado, cargar y copiar platos rechazan a todos, y eso lo prueba
// `test/carta/menu-del-dia-interruptor.test.ts`). Así el control positivo de esas acciones sigue probando la pertenencia y no solo el interruptor.
vi.mock("../../src/core/carta/menu-del-dia", async (original) => ({ ...(await original<typeof import("../../src/core/carta/menu-del-dia")>()), MENU_DEL_DIA_VISIBLE: true }));

import { definirMatriz } from "./denegacion/definir-matriz";
import { FAMILIAS } from "./denegacion/familias";

/** GT-3b, familia «carta»: secciones, géneros, ítems agrupados, promos, descuentos, tema y portal (ver `denegacion/definir-matriz.ts`). */
definirMatriz(FAMILIAS.carta);
