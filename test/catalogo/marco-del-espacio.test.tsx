import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRESENTACIONES_VISIBLES, pasosDelEspacio, pendientesDelProducto, type AccesoAlEspacio, type FormaDelProducto, type HechosDelProducto } from "../../src/core/catalogo/public";
import { MarcoDelEspacio, type ProductoDelMarco } from "../../src/components/catalogo/espacio-del-producto/marco";

/**
 * Fase 6, paso 6.12: el marco del espacio del producto dibuja lo que `pasosDelEspacio` le da (se mira el HTML del servidor). Lo que se afirma: un paso que el usuario no puede abrir sale como texto, SIN
 * enlace (nunca un `<a>` hacia un «No tenés permiso»); un paso de un módulo apagado no sale; la pestaña actual lleva `aria-current`; un paso con algo pendiente lleva la insignia «Pendiente»; la cabecera dice cómo
 * se vende y si está disponible acá. Quién puede qué lo calcula el servidor (`espacio-hechos.test.ts`, contra la base).
 */
const PV: FormaDelProducto = { tipo: "PV", seProduce: false, esAnclaDeAdicional: false };
const HECHOS: HechosDelProducto = { ...PV, modoDeVenta: "DIRECTO", precioDeVenta: 20000, opciones: { vendibleAca: true }, receta: { rechazo: "«Milanesas» no tiene receta: armala en Catálogo → Recetas para poder venderla." }, carta: { estado: "fuera" } };
const ACCESO_TOTAL: AccesoAlEspacio = { datos: true, ver: true, opciones: true, receta: "si", carta: "si" };
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
  it("con todos los permisos: las tres pestañas (Datos, Precios, Opciones), en orden, y ni Receta ni En la carta (están fuera de la ficha)", () => {
    const html = dibujar(ACCESO_TOTAL);
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/pv1", "/catalogo/productos/pv1/precios", "/catalogo/productos/pv1/opciones"]);
    expect(html).toContain('aria-label="Pasos del producto"');
    for (const titulo of ["Datos", "Precios", "Opciones"]) expect(html).toContain(titulo);
    for (const titulo of ["Receta", "En la carta"]) expect(html).not.toContain(titulo);
    expect(html).not.toContain("Resumen");
    expect(html).toContain('aria-label="Pestañas del producto"');
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

  it("quien no puede ver la FICHA del producto (solo la carta) no recibe el código, el tipo ni cómo se vende, ni un enlace al Resumen o a la lista de productos", () => {
    const producto: ProductoDelMarco = { ...PRODUCTO, fichaVisible: false };
    const html = dibujar({ datos: false, ver: false, opciones: false, receta: "sin-permiso", carta: "si" }, "en-la-carta", producto);
    expect(html).toMatch(/<h1[^>]*>Milanesas<\/h1>/);
    expect(html).toContain("Disponible en «Centro»");
    expect(html).not.toContain("PV_MILA");
    expect(html).not.toContain("Producto de venta (PV)");
    expect(html).not.toContain("Directo");
    expect(html).not.toContain("Por opción");
    expect(html).toContain("Datos");
    expect(enlaces(html)).toEqual([]); // la carta ya no es un enlace del marco: se llega desde Carta
  });

  it("la pestaña actual lleva aria-current y las demás no", () => {
    const html = dibujar(ACCESO_TOTAL, "opciones");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="\/catalogo\/productos\/pv1\/opciones"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/catalogo\/productos\/pv1\/opciones"/);
  });

  it("un paso sin permiso sale como texto, SIN enlace: ni `<a>` ni un destino a «No tenés permiso»", () => {
    const html = dibujar({ datos: false, ver: false, opciones: false, receta: "sin-permiso", carta: "sin-permiso" });
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/pv1"]);
    for (const titulo of ["Datos", "Precios", "Opciones"]) expect(html, titulo).toContain(titulo);
    expect(html).not.toContain("/datos");
    expect(html).not.toContain("/precios");
    expect(html).not.toContain("/opciones");
    expect(html).not.toContain("/catalogo/recetas/");
    expect(html).not.toContain("/en-la-carta");
  });

  it("contraespejo: con el permiso de UN paso, solo ese paso tiene enlace (la pestaña Datos siempre abre la ficha)", () => {
    const html = dibujar({ datos: false, ver: true, opciones: false, receta: "sin-permiso", carta: "sin-permiso" });
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/pv1", "/catalogo/productos/pv1/precios"]);
  });

  it("la receta y la carta no se dibujan en el marco, con o sin módulo: se llega desde Recetas y Carta", () => {
    for (const acceso of [ACCESO_TOTAL, { ...ACCESO_TOTAL, receta: "sin-modulo" as const }, { ...ACCESO_TOTAL, carta: "sin-modulo" as const }]) {
      const html = dibujar(acceso);
      expect(html).not.toContain("Receta");
      expect(html).not.toContain("En la carta");
      expect(html).not.toContain("/catalogo/recetas/");
    }
  });

  it("un paso con algo pendiente lleva la insignia «Pendiente»; uno sin permiso no la lleva aunque haya pendiente (no se revela)", () => {
    const conPendiente = dibujar(ACCESO_TOTAL, "portada", PRODUCTO, PV, { ...HECHOS, opciones: { vendibleAca: false } });
    expect(conPendiente.match(/Pendiente/g)).toHaveLength(1); // las opciones
    const sinPermiso = dibujar({ ...ACCESO_TOTAL, opciones: false }, "portada", PRODUCTO, PV, { ...HECHOS, opciones: { vendibleAca: false } });
    expect(sinPermiso).not.toContain("Pendiente");
  });

  it("una materia prima: Datos y «Cómo se compra» (la receta no se dibuja), sin la insignia de cómo se vende", () => {
    const mp: ProductoDelMarco = { ...PRODUCTO, id: "mp1", nombre: "Masa madre", tipo: "MP" };
    const forma: FormaDelProducto = { tipo: "MP", seProduce: true, esAnclaDeAdicional: false };
    const html = dibujar(ACCESO_TOTAL, "datos", mp, forma, { ...HECHOS, ...forma, opciones: null, carta: null });
    expect(enlaces(html)).toEqual(["/catalogo/productos", "/catalogo/productos/mp1", ...(PRESENTACIONES_VISIBLES ? ["/catalogo/productos/mp1/compra"] : [])]);
    expect(html).toContain("Materia prima (MP)");
    expect(html).not.toContain("Directo");
    expect(html).not.toContain("Precios");
    expect(html).not.toContain("Opciones");
  });
});
