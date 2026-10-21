import type { MouseEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Boton, claseDeBoton, type TamanoDeBoton, type VarianteDeBoton } from "../../src/ui/primitivas/boton";
import { Campo } from "../../src/ui/primitivas/campo";
import { Dialogo } from "../../src/ui/componentes/superposiciones/dialogo";

/**
 * Contrato de las piezas de `src/ui` que se puede comprobar sin navegador (el comportamiento del `<dialog>` nativo —foco atrapado, Escape, hoja inferior— se prueba en un
 * navegador real: test/e2e/ui-dialogo.spec.ts). Entorno de Vitest = Node, así que se mira el HTML que dibuja el servidor y el elemento que devuelve el componente.
 */
const VARIANTES_DE_BOTON: readonly VarianteDeBoton[] = ["primario", "acento", "secundario", "peligro", "enlace", "enlace-peligro", "sobre-tinta"];
const TAMANOS_DE_BOTON: readonly TamanoDeBoton[] = ["normal", "compacto", "chico", "tactil"];

function propsDe(elemento: ReactElement): Record<string, unknown> {
  return elemento.props as Record<string, unknown>;
}

describe("Boton", () => {
  it("es type=button por defecto (dentro de un formulario no lo envía por accidente) y respeta type=submit si se lo piden", () => {
    expect(renderToStaticMarkup(<Boton>Guardar</Boton>)).toContain('type="button"');
    expect(renderToStaticMarkup(<Boton type="submit">Guardar</Boton>)).toContain('type="submit"');
  });

  it("zona táctil de 44 px en celular en las 28 combinaciones de variante y tamaño", () => {
    for (const variante of VARIANTES_DE_BOTON) {
      for (const tamano of TAMANOS_DE_BOTON) expect(claseDeBoton(variante, tamano), `${variante}/${tamano}`).toMatch(/(^| )min-h-11( |$)/);
    }
  });

  it("cargando: avisa con aria-busy, ignora el clic y frena el envío del formulario (doble clic no manda dos veces)", () => {
    const alClic = vi.fn();
    const enCurso = Boton({ cargando: true, onClick: alClic, type: "submit", children: "Cobrar" });
    const preventDefault = vi.fn();
    (propsDe(enCurso).onClick as (e: MouseEvent<HTMLButtonElement>) => void)({ preventDefault } as unknown as MouseEvent<HTMLButtonElement>);
    expect(alClic).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(propsDe(enCurso)["aria-busy"]).toBe(true);

    const libre = Boton({ onClick: alClic, children: "Cobrar" });
    (propsDe(libre).onClick as (e: MouseEvent<HTMLButtonElement>) => void)({ preventDefault } as unknown as MouseEvent<HTMLButtonElement>);
    expect(alClic).toHaveBeenCalledTimes(1);
    expect(propsDe(libre)["aria-busy"]).toBeUndefined();
  });

  it("cargando no deshabilita el botón de verdad (se perdería el foco del teclado)", () => {
    // El atributo `disabled` (no la variante de Tailwind `disabled:opacity-50`, que sí está en la clase).
    expect(renderToStaticMarkup(<Boton cargando>Cobrar</Boton>)).not.toMatch(/<button[^>]*\sdisabled[\s=>]/);
    expect(renderToStaticMarkup(<Boton disabled>Cobrar</Boton>)).toMatch(/<button[^>]*\sdisabled[\s=>]/);
  });
});

describe("Campo", () => {
  it("la etiqueta está atada al campo y, sin ayuda ni error, no hay descripción ni aria-invalid", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="Nombre" name="nombre" />);
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<input`);
    expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("la ayuda se anuncia con aria-describedby", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="CUIT" ayuda="Sin guiones" />);
    const descripcion = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(descripcion).toBeTruthy();
    expect(html).toContain(`<p id="${descripcion}"`);
    expect(html).toContain("Sin guiones");
  });

  it("con error: aria-invalid, mensaje con role=alert y descripción que apunta al mensaje; ayuda y error juntos se declaran los dos", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="Precio" ayuda="En pesos" error="Ingresá un número mayor a 0" />);
    expect(html).toContain('aria-invalid="true"');
    const ids = /aria-describedby="([^"]+)"/.exec(html)?.[1].split(" ") ?? [];
    expect(ids).toHaveLength(2);
    const idError = ids.find((i) => i.endsWith("-error"));
    expect(html).toContain(`<p id="${idError}" role="alert"`);
    expect(html).toContain("Ingresá un número mayor a 0");
  });

  it("un campo obligatorio marca el asterisco como decorativo (no se lee dos veces) y deja required en el input", () => {
    const html = renderToStaticMarkup(<Campo etiqueta="Nombre" required />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("required");
  });

  it("dos campos en la misma pantalla no comparten id", () => {
    const html = renderToStaticMarkup(
      <>
        <Campo etiqueta="A" />
        <Campo etiqueta="B" />
      </>,
    );
    const ids = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("Dialogo", () => {
  it("el <dialog> se nombra con su título (aria-labelledby apunta al h2)", () => {
    const html = renderToStaticMarkup(
      <Dialogo abierto titulo="Nueva receta" onCerrar={() => {}}>
        <p>contenido</p>
      </Dialogo>,
    );
    const id = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain("Nueva receta");
    expect(html).toContain('aria-label="Cerrar"');
  });

  it("cerrado no monta los hijos (al cerrar se pierde su estado, como el Modal de antes)", () => {
    const html = renderToStaticMarkup(
      <Dialogo abierto={false} titulo="Nueva receta" onCerrar={() => {}}>
        <p>contenido</p>
      </Dialogo>,
    );
    expect(html).not.toContain("contenido");
    expect(html).toContain("<dialog");
  });

  it("hoja inferior en celular y diálogo centrado desde sm: (un solo componente, dos comportamientos)", () => {
    const html = renderToStaticMarkup(
      <Dialogo abierto titulo="x" onCerrar={() => {}}>
        <p>c</p>
      </Dialogo>,
    );
    expect(html).toContain("mt-auto");
    expect(html).toContain("sm:my-auto");
    expect(html).toContain("max-h-[90dvh]");
  });

  /** Las clases del `<dialog>` (el HTML de un diálogo abierto, sin los hijos). */
  const clasesDelDialogo = (html: string) => /<dialog[^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];

  it("sin props es centrado y angosto, con los tokens del sistema (superficie, tinta y velo) y sin ninguna variante dark:", () => {
    const html = renderToStaticMarkup(
      <Dialogo abierto titulo="x" onCerrar={() => {}}>
        <p>c</p>
      </Dialogo>,
    );
    const clases = clasesDelDialogo(html);
    expect(clases).toEqual(expect.arrayContaining(["bg-superficie", "text-tinta", "backdrop:bg-velo", "sm:max-w-sm", "max-w-md", "rounded-t-lg", "sm:rounded-lg"]));
    expect(clases).not.toEqual(expect.arrayContaining(["md:max-w-2xl"]));
    expect(clases).not.toContain("ml-auto");
    expect(html, "ni dark:, ni grises de escala, ni blanco o negro literales").not.toMatch(/dark:|neutral-|bg-white|black\//);
  });

  it("ancho=ancho agranda el diálogo desde md: (max-w-2xl) y deja de ser angosto; ancho=angosto es lo mismo que no decir nada", () => {
    const ancho = clasesDelDialogo(
      renderToStaticMarkup(
        <Dialogo abierto titulo="x" onCerrar={() => {}} ancho="ancho">
          <p>c</p>
        </Dialogo>,
      ),
    );
    expect(ancho).toContain("md:max-w-2xl");
    expect(ancho).not.toContain("sm:max-w-sm");
    expect(ancho, "sigue siendo la hoja inferior del celular").toContain("mt-auto");

    const angosto = renderToStaticMarkup(
      <Dialogo abierto titulo="x" onCerrar={() => {}} ancho="angosto">
        <p>c</p>
      </Dialogo>,
    );
    const sinProps = renderToStaticMarkup(
      <Dialogo abierto titulo="x" onCerrar={() => {}}>
        <p>c</p>
      </Dialogo>,
    );
    expect(clasesDelDialogo(angosto)).toEqual(clasesDelDialogo(sinProps));
    expect(clasesDelDialogo(angosto)).toContain("sm:max-w-sm");
  });

  it("forma=lateral es un panel pegado a la derecha, de alto completo y sin esquinas redondeadas, de ancho fijo (md:max-w-md); ya no es hoja inferior ni centrado", () => {
    const html = renderToStaticMarkup(
      <Dialogo abierto titulo="Detalle" onCerrar={() => {}} forma="lateral">
        <p>c</p>
      </Dialogo>,
    );
    const clases = clasesDelDialogo(html);
    expect(clases).toEqual(expect.arrayContaining(["ml-auto", "mr-0", "h-dvh", "max-h-dvh", "rounded-none", "md:max-w-md", "bg-superficie", "text-tinta", "backdrop:bg-velo"]));
    for (const deHojaOCentrado of ["mx-auto", "mt-auto", "max-h-[90dvh]", "rounded-t-lg", "sm:my-auto", "sm:max-w-sm", "md:max-w-2xl"]) expect(clases, deHojaOCentrado).not.toContain(deHojaOCentrado);
    // Lo que hace de él un diálogo accesible no cambia con la forma.
    const id = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain('aria-label="Cerrar"');
  });

  it("el tipo no deja combinar forma=lateral con un ancho (el panel lateral mide siempre lo mismo)", () => {
    const lateralConAncho = (
      // @ts-expect-error `ancho` no existe con `forma="lateral"`.
      <Dialogo abierto titulo="x" onCerrar={() => {}} forma="lateral" ancho="ancho">
        <p>c</p>
      </Dialogo>
    );
    expect(clasesDelDialogo(renderToStaticMarkup(lateralConAncho))).not.toContain("md:max-w-2xl");
  });

  it("el botón Cerrar usa tokens (tinta suave, foco del sistema) y conserva su zona táctil de 44 px en celular", () => {
    const html = renderToStaticMarkup(
      <Dialogo abierto titulo="x" onCerrar={() => {}}>
        <p>c</p>
      </Dialogo>,
    );
    const cerrar = /<button[^>]*aria-label="Cerrar"[^>]*>/.exec(html)?.[0] ?? "";
    expect(cerrar).toMatch(/\btext-tinta-suave\b/);
    expect(cerrar).toMatch(/\bfocus-visible:outline-foco\b/);
    expect(cerrar).toMatch(/\bmin-h-11\b/);
    expect(cerrar).toMatch(/\bmin-w-11\b/);
  });
});
