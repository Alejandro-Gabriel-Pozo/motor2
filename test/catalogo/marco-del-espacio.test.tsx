import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pasosDelEspacio, pendientesDelProducto, type AccesoAlEspacio, type FormaDelProducto, type HechosDelProducto } from "../../src/core/catalogo/public";
import { MarcoDelEspacio, type ProductoDelMarco } from "../../src/components/catalogo/espacio-del-producto/marco";

/**
 * Fase 6, paso 6.12: el marco del espacio del producto dibuja lo que `pasosDelEspacio` le da (se mira el HTML del servidor). Lo que se afirma: un paso que el usuario no puede abrir sale como texto, SIN
 * enlace (nunca un `<a>` hacia un «No tenés permiso»); un paso de un módulo apagado no sale; la pestaña actual lleva `aria-current`; un paso con algo pendiente lleva la insignia «Pendiente»; la cabecera dice cómo
 * se vende y si está disponible acá. Quién puede qué lo calcula el servidor (`espacio-hechos.test.ts`, contra la base).
 */
const PV: FormaDelProducto = { tipo: "PV", seProduce: false, esAnclaDeAdicional: false };
const HECHOS: HechosDelProducto = { ...PV, modoDeVenta: "DIRECTO", precioDeVenta: 20000, opciones: { vendibleAca: true }, receta: { rechazo: "«Milanesas» no tiene receta: armala en Catálogo → Recetas para poder venderla." }, carta: { estado: "fuera" } };
const ACCESO_TOTAL: AccesoAlEspacio = { datos: true, opciones: true, receta: "si", carta: "si" };
const PRODUCTO: ProductoDelMarco = { id: "pv1", nombre: "Milanesas", codigo: "PV_MILA", tipo: "PV", modoDeVenta: "DIRECTO", disponibleAca: true, sucursalNombre: "Centro" };

function dibujar(acceso: AccesoAlEspacio, actual: Parameters<typeof MarcoDelEspacio>[0]["actual"] = "portada", producto = PRODUCTO, forma: FormaDelProducto = PV, hechos = HECHOS): string {
  const pasos = pasosDelEspacio(producto.id, forma, acceso, pendientesDelProducto(hechos));
  return renderToStaticMarkup(
    <MarcoDelEspacio producto={producto} pasos={pasos} actual={actual}>
      <p>contenido</p>
    </MarcoDelEspacio>
  );
}

const enlaces = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

describe("MarcoDelEspacio", () => {
  it("con todos los permisos: Resumen y los cuatro pasos con su enlace, en orden", () => {
    const html = dibujar(ACCESO_TOTAL);
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/pv1", "/catalogo/productos/pv1/datos", "/catalogo/productos/pv1/opciones", "/catalogo/recetas/pv1", "/catalogo/productos/pv1/en-la-carta"]);
    expect(html).toContain('aria-label="Pasos del producto"');
    for (const titulo of ["Resumen", "Qué se vende", "Opciones y precio", "Receta", "En la carta"]) expect(html).toContain(titulo);
    expect(html).toContain("<p>contenido</p>");
  });

  it("el h1 es el nombre del producto y la cabecera dice cómo se vende y dónde está disponible", () => {
    const html = dibujar(ACCESO_TOTAL);
    expect(html).toMatch(/<h1[^>]*>Milanesas<\/h1>/);
    expect(html).toContain("Directo");
    expect(html).toContain("Disponible en «Centro»");
    const porOpcion = dibujar(ACCESO_TOTAL, "portada", { ...PRODUCTO, modoDeVenta: "BASE_CONFIGURABLE", disponibleAca: false });
    expect(porOpcion).toContain("Por opción");
    expect(porOpcion).toContain("No disponible en «Centro»");
    expect(porOpcion).not.toContain(">Directo<");
  });

  it("la pestaña actual lleva aria-current y las demás no", () => {
    const html = dibujar(ACCESO_TOTAL, "opciones");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="\/catalogo\/productos\/pv1\/opciones"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/catalogo\/productos\/pv1\/opciones"/);
  });

  it("un paso sin permiso sale como texto, SIN enlace: ni `<a>` ni un destino a «No tenés permiso»", () => {
    const html = dibujar({ datos: false, opciones: false, receta: "sin-permiso", carta: "sin-permiso" });
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/pv1"]);
    for (const titulo of ["Qué se vende", "Opciones y precio", "Receta", "En la carta"]) expect(html, titulo).toContain(titulo);
    expect(html).not.toContain("/datos");
    expect(html).not.toContain("/opciones");
    expect(html).not.toContain("/catalogo/recetas/");
    expect(html).not.toContain("/en-la-carta");
  });

  it("contraespejo: con el permiso de UN paso, solo ese paso tiene enlace", () => {
    const html = dibujar({ datos: true, opciones: false, receta: "sin-permiso", carta: "sin-permiso" });
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/pv1", "/catalogo/productos/pv1/datos"]);
  });

  it("sin el módulo de la receta o de la carta, el paso no aparece (no es «sin permiso»)", () => {
    const sinRecetas = dibujar({ ...ACCESO_TOTAL, receta: "sin-modulo" });
    expect(sinRecetas).not.toContain("Receta");
    expect(sinRecetas).toContain("En la carta");
    const sinCarta = dibujar({ ...ACCESO_TOTAL, carta: "sin-modulo" });
    expect(sinCarta).not.toContain("En la carta");
    expect(sinCarta).toContain("Receta");
  });

  it("un paso con algo pendiente lleva la insignia «Pendiente»; uno sin permiso no la lleva aunque haya pendiente (no se revela)", () => {
    const html = dibujar(ACCESO_TOTAL);
    expect(html.match(/Pendiente/g)).toHaveLength(2); // la receta y la carta
    const sinPermiso = dibujar({ ...ACCESO_TOTAL, receta: "sin-permiso", carta: "sin-permiso" });
    expect(sinPermiso).not.toContain("Pendiente");
  });

  it("una materia prima: Datos (y Receta si se produce), sin la insignia de cómo se vende", () => {
    const mp: ProductoDelMarco = { ...PRODUCTO, id: "mp1", nombre: "Masa madre", tipo: "MP" };
    const forma: FormaDelProducto = { tipo: "MP", seProduce: true, esAnclaDeAdicional: false };
    const html = dibujar(ACCESO_TOTAL, "datos", mp, forma, { ...HECHOS, ...forma, opciones: null, carta: null });
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/mp1", "/catalogo/productos/mp1/datos", "/catalogo/recetas/mp1"]);
    expect(html).toContain("Materia prima (MP)");
    expect(html).not.toContain("Directo");
    expect(html).not.toContain("Opciones y precio");
  });
});
