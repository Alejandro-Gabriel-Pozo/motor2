import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("../../src/server/actions/catalogo/proveedores", () => ({ altaProveedor: async () => ({ ok: true, mensaje: "" }), actualizarProveedor: async () => ({ ok: true, mensaje: "" }) }));

import { DIRECTORIO_AL_ESTILO_DE_PEDERNAL, filasDelDirectorio, hayBusquedaDelDirectorio, leerBusquedaDelDirectorio } from "../../src/core/catalogo/directorio-de-la-lista";
import { BuscadorDelDirectorio } from "../../src/components/catalogo/buscador-del-directorio";

/**
 * Paso 8 del plan de pantallas (dueño, 2026-11-17: «4a»): las listas de Proveedores y de Clientes con descuento con buscador, desactivados ocultos y alta de proveedor solo con el nombre, detrás de un
 * interruptor reversible (`DIRECTORIO_AL_ESTILO_DE_PEDERNAL`). El oráculo de cada regla está escrito aparte del código.
 */
interface Fila {
  nombre: string;
  codigo: string;
  contacto: string | null;
  activo: boolean;
}
const FILAS: Fila[] = [
  { nombre: "Carnicería Don José", codigo: "PRV-001", contacto: "Pedro Gómez", activo: true },
  { nombre: "Verdulería Sol", codigo: "PRV-002", contacto: null, activo: true },
  { nombre: "Lácteos del Sur", codigo: "PRV-003", contacto: "ventas@lacteos.test", activo: false },
  { nombre: "José Pérez e hijos", codigo: "PRV-004", contacto: "Ana", activo: false },
];
const textos = (f: Fila) => [f.nombre, f.codigo, f.contacto];
const ver = (entrada: Parameters<typeof leerBusquedaDelDirectorio>[0], estilo = true) => filasDelDirectorio(FILAS, leerBusquedaDelDirectorio(entrada), textos, estilo).map((f) => f.codigo);

describe("leerBusquedaDelDirectorio (lista de permitidos)", () => {
  it("sin nada: texto vacío y sin desactivados", () => {
    expect(leerBusquedaDelDirectorio({})).toEqual({ q: "", mostrarDesactivados: false });
  });
  it("el texto se recorta y se limita a 100 caracteres", () => {
    expect(leerBusquedaDelDirectorio({ q: "  sol  " }).q).toBe("sol");
    expect(leerBusquedaDelDirectorio({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
  it("«desactivados» vale SOLO con el texto exacto «1»; cualquier otra cosa o repetido es «no»", () => {
    expect(leerBusquedaDelDirectorio({ desactivados: "1" }).mostrarDesactivados).toBe(true);
    for (const raro of ["", "0", "true", "si", "on", "1 ", "11", ["1", "1"]]) expect(leerBusquedaDelDirectorio({ desactivados: raro }).mostrarDesactivados, JSON.stringify(raro)).toBe(false);
  });
  it("un texto repetido en la dirección (arreglo) no se usa", () => {
    expect(leerBusquedaDelDirectorio({ q: ["a", "b"] }).q).toBe("");
  });
  it("hayBusquedaDelDirectorio: con texto o con desactivados", () => {
    expect(hayBusquedaDelDirectorio({ q: "", mostrarDesactivados: false })).toBe(false);
    expect(hayBusquedaDelDirectorio({ q: "a", mostrarDesactivados: false })).toBe(true);
    expect(hayBusquedaDelDirectorio({ q: "", mostrarDesactivados: true })).toBe(true);
  });
});

describe("filasDelDirectorio: oráculo de lo que se ve", () => {
  it("hoy el interruptor está encendido", () => {
    expect(DIRECTORIO_AL_ESTILO_DE_PEDERNAL).toBe(true);
  });
  it("sin búsqueda: solo los activos, en el mismo orden", () => {
    expect(ver({})).toEqual(["PRV-001", "PRV-002"]);
  });
  it("con «Mostrar desactivados»: todos", () => {
    expect(ver({ desactivados: "1" })).toEqual(["PRV-001", "PRV-002", "PRV-003", "PRV-004"]);
  });
  it("busca por nombre, código y contacto, sin mayúsculas ni acentos", () => {
    expect(ver({ q: "carniceria" })).toEqual(["PRV-001"]);
    expect(ver({ q: "PRV-002" })).toEqual(["PRV-002"]);
    expect(ver({ q: "gomez" })).toEqual(["PRV-001"]);
    expect(ver({ q: "JOSÉ" })).toEqual(["PRV-001"]);
  });
  it("todas las palabras, en cualquier orden y con espacios de más", () => {
    expect(ver({ q: "  jose   carniceria " })).toEqual(["PRV-001"]);
    expect(ver({ q: "jose zzz" })).toEqual([]);
  });
  it("los desactivados que coinciden solo aparecen si se piden", () => {
    expect(ver({ q: "lacteos" })).toEqual([]);
    expect(ver({ q: "lacteos", desactivados: "1" })).toEqual(["PRV-003"]);
    expect(ver({ q: "jose", desactivados: "1" })).toEqual(["PRV-001", "PRV-004"]);
  });
  it("lo que se busca no se interpreta: comodines, regex y comillas son texto", () => {
    for (const q of ["%", ".*", "'; DROP TABLE", "<script>", "\\"]) expect(ver({ q, desactivados: "1" }), q).toEqual([]);
  });
  it("con el interruptor apagado se ven todas, como siempre, aunque la dirección pida otra cosa", () => {
    expect(ver({}, false)).toEqual(["PRV-001", "PRV-002", "PRV-003", "PRV-004"]);
    expect(ver({ q: "sol" }, false)).toEqual(["PRV-001", "PRV-002", "PRV-003", "PRV-004"]);
  });
  it("no muta lo que recibe ni cambia el orden", () => {
    const copia = JSON.stringify(FILAS);
    ver({ q: "a", desactivados: "1" });
    expect(JSON.stringify(FILAS)).toBe(copia);
  });
});

describe("BuscadorDelDirectorio", () => {
  const html = (busqueda: { q: string; mostrarDesactivados: boolean }) =>
    renderToStaticMarkup(<BuscadorDelDirectorio accion="/catalogo/proveedores" busqueda={busqueda} etiqueta="Buscar por nombre" marcador="Nombre…" />);
  it("trae el buscador, «Mostrar desactivados» y «Buscar»; sin nada puesto, sin «Limpiar»", () => {
    const h = html({ q: "", mostrarDesactivados: false });
    for (const t of ["Buscar por nombre", "Mostrar desactivados", 'name="q"', 'name="desactivados"', 'value="1"', ">Buscar<", 'method="get"', 'action="/catalogo/proveedores"']) expect(h).toContain(t);
    expect(h).not.toContain("Limpiar");
    expect(h).not.toContain("checked");
  });
  it("con lo puesto: el texto, la casilla tildada y «Limpiar»", () => {
    const h = html({ q: "sol", mostrarDesactivados: true });
    expect(h).toContain('value="sol"');
    expect(h).toContain("checked");
    expect(h).toContain("Limpiar");
  });
});

describe("el alta de un proveedor pide solo el nombre (resto plegado); la edición, todo a la vista", () => {
  const dibujar = async (estilo: boolean, editando: boolean) => {
    vi.resetModules();
    vi.doMock("../../src/core/catalogo/directorio-de-la-lista", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/directorio-de-la-lista")>()), DIRECTORIO_AL_ESTILO_DE_PEDERNAL: estilo }));
    const { ProveedorForm } = await import("../../src/app/(app)/catalogo/proveedores/proveedor-form");
    const existente = { id: "p1", codigo: "PRV-001", nombre: "Sol", ofreceProductos: true, ofreceServicios: false };
    const h = renderToStaticMarkup(<ProveedorForm proveedorExistente={editando ? existente : undefined} />);
    vi.doUnmock("../../src/core/catalogo/directorio-de-la-lista");
    return h;
  };
  const CAMPOS = ['name="contacto"', 'name="telefono"', 'name="email"', 'name="cuit"', 'name="condicionesPago"', 'name="notas"', 'name="ofreceProductos"', 'name="ofreceServicios"'];
  it("con el estilo: el alta tiene el nombre a la vista y todo lo demás dentro de «Más datos, si los tenés» (siguen en el formulario)", async () => {
    const h = await dibujar(true, false);
    expect(h).toContain('name="nombre"');
    expect(h).toContain("Más datos, si los tenés");
    const desde = h.indexOf("<details");
    expect(desde).toBeGreaterThan(h.indexOf('name="nombre"'));
    for (const c of CAMPOS) expect(h.indexOf(c), c).toBeGreaterThan(desde);
  });
  it("con el estilo: la edición no se pliega", async () => {
    const h = await dibujar(true, true);
    expect(h).not.toContain("Más datos, si los tenés");
    for (const c of CAMPOS) expect(h).toContain(c);
  });
  it("sin el estilo: el alta de siempre, sin plegar", async () => {
    const h = await dibujar(false, false);
    expect(h).not.toContain("Más datos, si los tenés");
    for (const c of CAMPOS) expect(h).toContain(c);
  });
});
