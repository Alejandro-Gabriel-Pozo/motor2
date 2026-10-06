import { describe, expect, it } from "vitest";
import { esDeGrupoProtegido, esPagina, leerDeApp, listarArchivosDeApp } from "./guardas/entradas-de-app";
import { analizarPagina } from "./guardas/rutas";

/**
 * Toda página de `(app)`/`(pos)` abre con la guarda de permiso de `server/acceso/gate` y corta si no hay permiso, ANTES de leer nada. El layout
 * solo decide si hay sesión; sin esta guarda, una página nueva (o una anidada que olvidó copiarla) mostraría sus datos a cualquier usuario con
 * sesión, de cualquier rol, por URL directa. Los tests `reportes-con-permiso` y `menu-con-permiso` solo miran las pantallas del menú y de reportes.
 *
 * Es un test ESTÁTICO (AST, `guardas/rutas.ts`): evita el olvido. Que la barrera funcione de verdad lo demuestran los e2e con un rol sin el permiso.
 */

/** Páginas protegidas que NO llevan guarda de permiso, con el motivo. Se revisa en las dos direcciones: si la página la incorpora, la excepción sobra. */
const EXCEPCIONES: Record<string, string> = {
  "(app)/inicio/page.tsx":
    "la pantalla de inicio es de cualquier usuario con sesión: arma sus tarjetas con `tarjetasDelUsuario(ctx)`, que ya muestra solo lo que su rol puede ver",
};

const paginas = listarArchivosDeApp().filter((a) => esPagina(a) && esDeGrupoProtegido(a));

describe("páginas de (app)/(pos): guarda de permiso antes de leer", () => {
  for (const pagina of paginas.filter((p) => !(p in EXCEPCIONES))) {
    it(`${pagina} exige el permiso en el servidor antes de leer`, () => {
      const r = analizarPagina(pagina, leerDeApp(pagina));
      expect(r.estado, `${pagina}:${r.linea}`).toBe("ok");
    });
  }

  it("las excepciones siguen existiendo, siguen sin guarda y tienen motivo", () => {
    for (const [pagina, motivo] of Object.entries(EXCEPCIONES)) {
      expect(paginas, `la excepción "${pagina}" ya no existe`).toContain(pagina);
      expect(analizarPagina(pagina, leerDeApp(pagina)).estado, `"${pagina}" ahora tiene guarda: sacala de EXCEPCIONES`).toBe("sin-guarda");
      expect(motivo.trim().length, `"${pagina}" sin motivo`).toBeGreaterThan(10);
    }
  });
});
