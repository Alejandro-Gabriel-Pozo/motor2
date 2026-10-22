import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA (abrir la ventana, el envío, el doble clic y el cierre van en
// `test/e2e/catalogo-opcion-en-el-producto.spec.ts`).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/opciones-de-venta", () => ({ crearOpcionEnElProducto: vi.fn() }));

import { FormularioDeOpcionNuevaEnVentana, NuevaOpcionEnElGrupo } from "../../src/components/catalogo/nueva-opcion-en-el-grupo";
import { formularioDeOpcionInicial, loQueLleva, textosDeLaVentana, type LoQueLleva } from "../../src/components/catalogo/nueva-opcion-en-el-grupo-formulario";

const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const nada = () => undefined;
const unidades = [
  { id: "u1", nombre: "unidad" },
  { id: "u2", nombre: "g" },
];

const dibujar = (lleva: LoQueLleva, props: { error?: string | null; cargando?: boolean } = {}) => {
  const tipo = lleva === "cobra" ? "ADICIONAL" : lleva === "nada" ? "INCLUIDA" : "VARIANTE";
  return renderToStaticMarkup(
    <FormularioDeOpcionNuevaEnVentana
      lleva={lleva}
      textos={textosDeLaVentana(tipo, "Grupo")}
      unidades={unidades}
      formulario={formularioDeOpcionInicial(lleva)}
      alCambiar={nada}
      alEnviar={nada}
      alCancelar={nada}
      error={props.error ?? null}
      cargando={props.cargando ?? false}
    />,
  );
};

describe("NuevaOpcionEnElGrupo (cerrado)", () => {
  const dibujarCerrado = (tipo: "VARIANTE" | "ADICIONAL") =>
    renderToStaticMarkup(
      <NuevaOpcionEnElGrupo productoId="p1" productoNombre="Café" grupoId="g1" grupoNombre={tipo === "ADICIONAL" ? "Extras" : "Leche"} tipo={tipo} modoPrecio={null} versionEsperada={1} unidades={unidades} />,
    );

  it("dibuja «+ Opción» (o «+ Extra» en un adicional) con el grupo en su nombre accesible y el diálogo cerrado, sin el formulario adentro", () => {
    const opcion = dibujarCerrado("VARIANTE");
    expect(opcion).toMatch(/<button[^>]*aria-label="\+ Opción en Leche"[^>]*>\s*\+ Opción\s*<\/button>/);
    expect(opcion).toContain("<dialog");
    expect(opcion).not.toContain("<form");
    const extra = dibujarCerrado("ADICIONAL");
    expect(extra).toMatch(/<button[^>]*aria-label="\+ Extra en Extras"[^>]*>\s*\+ Extra\s*<\/button>/);
  });

  it("cerrado no monta nada de la ventana (ni un alert viejo que se anuncie)", () => {
    const html = dibujarCerrado("VARIANTE");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
  });
});

describe("el formulario de la ventana: lo que pide según el grupo", () => {
  it("una variante o una medida en diferencia: nombre y «Cuánto suma» (arranca en 0, sin unidad)", () => {
    const html = dibujar("suma");
    const t = texto(html);
    expect(t).toContain("Nombre de la opción");
    expect(t).toContain("Cuánto suma");
    expect(html).toMatch(/id="importe-de-la-opcion-nueva"[^>]*value="0"/);
    expect(t).not.toContain("Unidad para el stock");
    expect(t).toContain("Agregar la opción");
  });

  it("una medida en precio propio: «Precio final de la opción» (sin valor de partida)", () => {
    const html = dibujar("precio-final");
    expect(texto(html)).toContain("Precio final de la opción");
    expect(html).not.toMatch(/id="importe-de-la-opcion-nueva"[^>]*value="0"/);
  });

  it("un extra (adicional): «Cuánto cobra», la unidad del respaldo con sus opciones y «Agregar el extra»", () => {
    const html = dibujar("cobra");
    const t = texto(html);
    expect(t).toContain("Nombre del extra");
    expect(t).toContain("Cuánto cobra");
    expect(t).toContain("Unidad para el stock del extra");
    expect(t).toContain("Elegí la unidad");
    expect(html).toMatch(/<option value="u1">\s*unidad\s*<\/option>/);
    expect(html).toMatch(/<option value="u2">\s*g\s*<\/option>/);
    expect(t).toContain("Agregar el extra");
  });

  it("un grupo incluido: solo el nombre, sin importe ni unidad", () => {
    const html = dibujar("nada");
    expect(html).not.toContain("importe-de-la-opcion-nueva");
    expect(texto(html)).not.toContain("Unidad para el stock");
  });

  it("el error del servidor queda DENTRO de la ventana (role=alert) y «Agregar» ocupado marca aria-busy", () => {
    const html = dibujar("suma", { error: "«Avena» ya está.", cargando: true });
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain("«Avena» ya está.");
    expect(html).toContain('aria-busy="true"');
  });

  it("el rol de cada grupo sale del tipo y del modo de precio que dibuja la página", () => {
    expect(loQueLleva("MEDIDA", "ABSOLUTO")).toBe("precio-final");
  });
});
