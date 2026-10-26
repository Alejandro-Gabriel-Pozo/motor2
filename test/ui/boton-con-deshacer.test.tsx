import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AvisoConDeshacer, BotonConDeshacer } from "../../src/components/aviso-con-deshacer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

/**
 * `BotonConDeshacer` (archivar, restaurar, quitar y volver a vincular una opción o un grupo): su zona táctil es de 44 px en CUALQUIER ancho, también en escritorio (como antes de
 * migrar a `Boton`; `catalogo-opciones-archivar.spec.ts` lo mide a 1280 px). Se mira el HTML del servidor: ninguna clase de alto detrás de `md:` y la de 44 px sin prefijo.
 */
function clasesDelBoton(principal: boolean): string[] {
  const html = renderToStaticMarkup(
    <AvisoConDeshacer>
      <BotonConDeshacer valor={false} principal={principal} etiquetaAccesible="Restaurar Leche" accion={async () => ({ ok: true, mensaje: "listo" })}>
        Restaurar
      </BotonConDeshacer>
    </AvisoConDeshacer>
  );
  const clase = /<button[^>]*class="([^"]*)"/.exec(html)?.[1];
  if (!clase) throw new Error(`Sin <button> con clase en: ${html}`);
  return clase.split(" ");
}

describe("BotonConDeshacer: 44 px también en escritorio", () => {
  for (const principal of [false, true]) {
    it(`${principal ? "principal" : "secundario"}: min-h-11 sin ninguna altura menor detrás de md:`, () => {
      const dibujadas = clasesDelBoton(principal);
      expect(dibujadas.filter((c) => /min-h-/.test(c))).toEqual(["min-h-11"]);
      expect(dibujadas.some((c) => /^md:/.test(c))).toBe(false);
    });
  }
});
