import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA (abrir la ventana, el envío, el doble clic y el cierre van en el e2e
// `espacio-del-producto.spec.ts` de 6.20).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/opciones-de-venta", () => ({ crearGrupoEnElProducto: vi.fn() }));

import { FormularioDeGrupoNuevoEnVentana, NuevoGrupoEnElProducto } from "../../src/components/catalogo/nuevo-grupo-en-el-producto";
import { formularioInicial, type FormularioDeGrupoNuevo } from "../../src/components/catalogo/nuevo-grupo-en-el-producto-formulario";
import { MAX_OPCIONES_EN_UN_ALTA } from "../../src/core/features/catalogo/opciones-de-venta.guard";

/**
 * Fase 6, paso 6.15c: `NuevoGrupoEnElProducto` y el formulario de su ventana, lo que DIBUJAN: la pregunta «¿Cambia el precio?» como grupo de radios con su leyenda y sus tres respuestas, lo que cambia con
 * cada una (importes, «Se lee en la carta como», lecturas del precio), «+ Otra opción» con su tope y «Crear grupo» ocupado con `aria-busy`.
 */
const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const nada = () => undefined;

const form = ({ filas, ...resto }: Omit<Partial<FormularioDeGrupoNuevo>, "filas"> & { filas?: [string, string][] } = {}): FormularioDeGrupoNuevo => ({
  ...formularioInicial(),
  ...resto,
  ...(filas ? { filas: filas.map(([nombre, importe], i) => ({ clave: i, nombre, importe })) } : {}),
});

const dibujar = (
  f: FormularioDeGrupoNuevo,
  props: { error?: string | null; cargando?: boolean; referencia?: { opcion: string; precio: number } | null; precioDeLista?: number | null } = {},
) =>
  renderToStaticMarkup(
    <FormularioDeGrupoNuevoEnVentana
      formulario={f}
      alCambiar={nada}
      alAgregarOpcion={nada}
      alEnviar={nada}
      alCancelar={nada}
      error={props.error ?? null}
      cargando={props.cargando ?? false}
      referencia={props.referencia ?? null}
      precioDeLista={props.precioDeLista ?? null}
    />,
  );

describe("NuevoGrupoEnElProducto (cerrado)", () => {
  const html = renderToStaticMarkup(<NuevoGrupoEnElProducto productoId="p1" productoNombre="Milanesas" />);

  it("dibuja el botón «+ Nuevo grupo» y el diálogo cerrado, sin el formulario adentro", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>\s*\+ Nuevo grupo\s*<\/button>/);
    expect(html).toContain("<dialog");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Crear grupo");
  });

  it("cerrado no monta nada de la ventana (ni su título ni un aviso): no hay un alert viejo que se anuncie", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});

describe("el formulario de la ventana: «¿Cambia el precio?»", () => {
  const html = dibujar(form());

  it("es un grupo de radios con su leyenda, en tarjetas, con las tres respuestas y ninguna elegida", () => {
    expect(html).toMatch(/<fieldset[^>]*>\s*<legend[^>]*>¿Cambia el precio\?<\/legend>/);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
    expect(html).toContain("No, va incluido");
    expect(html).toContain("Solo algunas opciones suman un importe");
    expect(html).toContain("Cada opción define el precio final");
    expect(html).toContain("has-checked:border-tinta"); // presentación en tarjetas
  });

  it("dice que el tipo no se cambia después", () => {
    expect(texto(html)).toContain("el tipo no se cambia después");
  });

  it("pide el nombre del grupo (obligatorio, con su etiqueta atada) y abre con 3 filas de opción", () => {
    expect(html).toMatch(/<label[^>]*>Nombre del grupo<span[^>]*> \*<\/span><\/label>/);
    expect(html).toMatch(/<input[^>]*required=""/);
    expect((html.match(/data-opcion-nueva=/g) ?? []).length).toBe(3);
    for (const n of [1, 2, 3]) expect(html).toContain(`Nombre de la opción ${n}`);
  });

  it("sin respuesta elegida no hay importes ni «Se lee en la carta como»", () => {
    expect(html).not.toContain("Se lee en la carta como");
    expect(html).not.toContain("Importe que suma");
    expect(html).not.toContain("Precio final de la opción");
  });

  it("«Crear grupo» y «Cancelar»; el botón de crear es el único que envía y no está ocupado", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Crear grupo<\/button>/);
    expect((html.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>\s*Cancelar\s*<\/button>/);
    expect(html).not.toContain(`aria-busy="`);
  });
});

describe("el formulario según la respuesta", () => {
  it("«No, va incluido»: solo los nombres (sin importes, sin lectura del precio y sin «Se lee en la carta como»)", () => {
    const html = dibujar(form({ respuesta: "INCLUIDO", filas: [["Jugoso", ""], ["A punto", ""]] }));
    expect(html).not.toContain("Importe que suma");
    expect(html).not.toContain("Precio final de la opción");
    expect(html).not.toContain("Se lee en la carta como");
    expect(html).not.toContain('aria-live="polite"');
    expect((html.match(/data-opcion-nueva=/g) ?? []).length).toBe(2);
  });

  it("«Cada opción define el precio final»: el precio final de cada opción con su lectura, y «Se lee en la carta como»", () => {
    const html = dibujar(form({ respuesta: "PRECIO_FINAL", prefijo: "De", filas: [["Chico", "2500"], ["Mediano", ""], ["", ""]] }));
    expect(html).toContain("Precio final de la opción 1");
    expect(html).toContain("Precio final de la opción 3");
    expect(texto(html)).toContain("Chico = $ 2.500");
    expect(texto(html)).toContain("Falta el precio final de «Mediano»");
    expect(html).toContain("Se lee en la carta como");
    expect(texto(html)).toContain("En la carta se verá: De chico · De mediano");
  });

  it("«Solo algunas opciones suman un importe»: el importe que suma de cada opción; la suma se lee solo contra la referencia del producto", () => {
    const filas: [string, string][] = [["Trucha", "3000"], ["Queso", ""]];
    const sinBase = dibujar(form({ respuesta: "SUMA", filas }));
    expect(sinBase).toContain("Importe que suma la opción 1");
    expect(texto(sinBase)).not.toContain("Trucha =");
    expect(texto(sinBase)).not.toContain("Trucha con");
    const conBase = dibujar(form({ respuesta: "SUMA", filas }), { referencia: { opcion: "Napolitana", precio: 25000 } });
    expect(texto(conBase)).toContain("Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000");
  });

  it("sin prefijo, «Se lee en la carta como» dice que cada opción se lee con su nombre", () => {
    expect(texto(dibujar(form({ respuesta: "SUMA", filas: [["Trucha", ""]] })))).toContain("Sin prefijo: cada opción se lee con su nombre.");
  });

  it("cada importe es un campo con su etiqueta atada y una región de lectura en vivo", () => {
    const html = dibujar(form({ respuesta: "PRECIO_FINAL", filas: [["Chico", "2500"], ["Mediano", "2800"]] }));
    expect(html).toMatch(/<label for="importe-de-la-opcion-0"[^>]*>Precio final de la opción 1<\/label>/);
    expect(html).toContain('id="importe-de-la-opcion-0"');
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(2 + 1); // una lectura por importe y la de «Se lee en la carta como»
  });
});

describe("el tope de opciones y el estado de envío", () => {
  it("con el tope de opciones, «+ Otra opción» queda deshabilitado y lo dice", () => {
    const llenas = Array.from({ length: MAX_OPCIONES_EN_UN_ALTA }, (_, i) => [`Opción ${i + 1}`, ""] as [string, string]);
    const html = dibujar(form({ respuesta: "INCLUIDO", filas: llenas }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*\+ Otra opción\s*<\/button>/);
    expect(texto(html)).toContain(`Hasta ${MAX_OPCIONES_EN_UN_ALTA} opciones por vez`);
    const menos = dibujar(form({ respuesta: "INCLUIDO", filas: llenas.slice(0, MAX_OPCIONES_EN_UN_ALTA - 1) }));
    expect(menos).not.toMatch(/<button[^>]*disabled=""[^>]*>\s*\+ Otra opción/);
  });

  it("mientras se envía: el formulario y «Crear grupo» llevan aria-busy", () => {
    const html = dibujar(form({ respuesta: "INCLUIDO", filas: [["Jugoso", ""]] }), { cargando: true });
    expect(html).toMatch(/<form[^>]*aria-busy="true"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*type="submit"/);
  });

  it("un rechazo del servidor se ve DENTRO del formulario como un aviso de error (role alert), una sola vez", () => {
    const mensaje = "Ya hay un grupo «Tamaño» en la biblioteca y no es igual a este: agregalo con «Agregar un grupo existente» o elegí otro nombre.";
    const html = dibujar(form({ respuesta: "INCLUIDO", filas: [["Jugoso", ""]] }), { error: mensaje });
    expect((html.match(/role="alert"/g) ?? []).length).toBe(1);
    expect(texto(html)).toContain(mensaje);
    expect(dibujar(form())).not.toContain('role="alert"');
  });
});
