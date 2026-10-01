import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Una página de EDICIÓN no puede protegerse solo con el permiso de VER: quien tiene Ver y no Editar entra por URL directa, el formulario completo se
 * dibuja, se llena, y recién al guardar la acción lo rechaza. La página tiene que exigir el permiso de EDITAR en el servidor (`requierePermiso`, no
 * `requierePermisoVer`), además del de Ver que decide a qué familia de pantallas pertenece (esos dos tests estáticos leen el primer literal de
 * `requierePermisoVer`, por eso ese va primero).
 *
 * Es un test ESTÁTICO: solo evita el olvido. Que la barrera funcione de verdad lo demuestra el E2E `catalogo-productos-permiso-editar.spec.ts` (con un
 * rol real sin el permiso): sacar el `return` del gate deja este test en verde y ese en rojo.
 */
const RAIZ = join(__dirname, "../../src/app/(app)");

const PAGINAS_DE_EDICION = [
  { pagina: "catalogo/productos/[id]/editar/page.tsx", clave: "editar_producto" },
  { pagina: "catalogo/productos/nuevo/page.tsx", clave: "alta_producto" },
];

describe("páginas de edición: exigen el permiso de Editar en el servidor", () => {
  for (const { pagina, clave } of PAGINAS_DE_EDICION) {
    it(`${pagina} llama a requierePermiso(..., "${clave}")`, () => {
      const fuente = readFileSync(join(RAIZ, pagina), "utf8").replace(/\r\n/g, "\n");
      expect(fuente).toMatch(new RegExp(String.raw`requierePermiso(?:DeEmpresa)?\(\s*[^,]+,\s*[^,]+,\s*"${clave}"\s*(?:,\s*[^,)]+)?\)`));
    });
  }
});
