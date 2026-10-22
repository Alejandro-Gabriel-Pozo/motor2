import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, revisarCerco, type Cerco } from "./trinquete";

/**
 * Lo único del trinquete que necesita Vitest: registra el test de un cerco. Vive aparte de `trinquete.ts` a propósito: `trinquete.ts` (leer el repo, listar archivos, sacar comentarios, el AST) lo usa
 * también el ejecutor de evidencia de los contratos (`contratos/ejecutar.ts`, que corre con `tsx` y SIN Vitest), y un módulo que importa `vitest` no se puede cargar fuera de su corredor.
 */
const DIR_LINEA_DE_BASE = join(__dirname, "linea-de-base");

/** Registra en Vitest el test del trinquete de `cerco` contra la línea de base real del repo (`linea-de-base/`). */
export function probarCerco(cerco: Cerco): void {
  describe(`cerco «${cerco.regla}»: la línea de base solo baja`, () => {
    it("ninguna cuenta subió, ninguna bajó sin fijarse, y las excepciones y los motivos siguen haciendo falta", () => {
      const revision = revisarCerco(cerco, {
        raizDelRepo: RAIZ_DEL_REPO,
        dirLineaDeBase: DIR_LINEA_DE_BASE,
        bajar: process.env.BAJAR_CERCOS === "1",
        crear: process.env.CREAR_CERCOS === "1",
      });
      expect(revision.problemas, revision.problemas.join("\n\n")).toEqual([]);
    });
  });
}
