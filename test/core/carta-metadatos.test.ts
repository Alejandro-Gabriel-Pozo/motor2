import { describe, expect, it } from "vitest";
import {
  descripcionDeCartaDeSucursal,
  descripcionDelPortal,
  imagenParaCompartir,
  LARGO_MAXIMO_DESCRIPCION_PUBLICA,
  LARGO_MAXIMO_TITULO_PUBLICO,
  recortarTexto,
  tituloDeCartaDeSucursal,
  tituloDelPortal,
} from "@/core/carta/metadatos";
import { origenPublicoDeCarta } from "@/core/carta/carta-empresa-unica";
import { nombrePublicoUsable } from "@/core/carta/metadatos";
import {
  NOMBRE_VALIDO,
  ORACULO,
  SECCIONES_DE_LA_CARTA,
  SUCURSAL_DE_LA_CARTA,
  SUCURSALES_DEL_PORTAL,
  VALORES_INVALIDOS_AL_LEER,
  VALORES_SIN_CARGAR,
  type EstadoDelNombre,
} from "../carta/oraculo-metadatos";

/** El valor guardado de cada estado del dato, para recorrer el oráculo (el estado «sin cargar» y el «inválido al leer» tienen VARIOS valores: salen todos). */
function valoresDe(estado: EstadoDelNombre): readonly unknown[] {
  return estado === "valido" ? [NOMBRE_VALIDO] : estado === "sin-cargar" ? VALORES_SIN_CARGAR : VALORES_INVALIDOS_AL_LEER;
}

/** La parte pública no muestra el nombre de la aplicación: ningún texto armado acá puede mencionarlo. */
const SIN_NOMBRE_DE_LA_APP = /motor2|\berp\b/i;

describe("el oráculo: dato × pantalla (F1: neutro sin nombre válido)", () => {
  for (const fila of ORACULO) {
    for (const valor of valoresDe(fila.estado)) {
      it(`${fila.estado} (${JSON.stringify(valor)}) en ${fila.pantalla}`, () => {
        const nombre = nombrePublicoUsable(valor);
        const titulo = fila.pantalla === "carta" ? tituloDeCartaDeSucursal(SUCURSAL_DE_LA_CARTA, nombre) : tituloDelPortal(null, nombre);
        const descripcion =
          fila.pantalla === "carta"
            ? descripcionDeCartaDeSucursal({ nombre: SUCURSAL_DE_LA_CARTA, nombreEmpresa: nombre, secciones: SECCIONES_DE_LA_CARTA })
            : descripcionDelPortal(SUCURSALES_DEL_PORTAL, nombre);
        expect({ titulo, descripcion, nombreDelSitio: nombre }).toEqual({ titulo: fila.titulo, descripcion: fila.descripcion, nombreDelSitio: fila.nombreDelSitio });
        // Aunque la página pase el valor crudo a las funciones, el resultado es el mismo (fallan cerradas por sí mismas).
        expect(fila.pantalla === "carta" ? tituloDeCartaDeSucursal(SUCURSAL_DE_LA_CARTA, valor as string) : tituloDelPortal(null, valor as string)).toBe(fila.titulo);
      });
    }
  }
});

describe("nombrePublicoUsable", () => {
  it("recorta y normaliza a NFC un nombre válido; todo lo demás es null", () => {
    expect(nombrePublicoUsable("  Empresa B  ")).toBe("Empresa B");
    expect(nombrePublicoUsable("Cafe\u0301 Sur")).toBe("Caf\u00e9 Sur");
    for (const v of [...VALORES_SIN_CARGAR, ...VALORES_INVALIDOS_AL_LEER]) expect(nombrePublicoUsable(v), JSON.stringify(v)).toBeNull();
  });
});

describe("títulos", () => {
  it("la carta de una sucursal es «<nombre> · Carta · <nombre público>»", () => {
    expect(tituloDeCartaDeSucursal("El Pirquinero", NOMBRE_VALIDO)).toBe("El Pirquinero · Carta · Empresa B");
  });
  it("no repite el nombre público si el nombre de la sucursal ya lo trae", () => {
    expect(tituloDeCartaDeSucursal("Empresa B Centro", NOMBRE_VALIDO)).toBe("Empresa B Centro · Carta");
  });
  it("si con el nombre público no entra en 60, se queda con «<nombre> · Carta»; si ni eso entra, recorta con «…»", () => {
    const largo = "Restaurante Panorámico del Alto Valle Patagónico";
    expect(tituloDeCartaDeSucursal(largo, NOMBRE_VALIDO)).toBe(`${largo} · Carta`);
    const larguisimo = "Restaurante ".repeat(10);
    const t = tituloDeCartaDeSucursal(larguisimo, NOMBRE_VALIDO);
    expect(t.length).toBeLessThanOrEqual(LARGO_MAXIMO_TITULO_PUBLICO);
    expect(t.endsWith("…")).toBe(true);
  });
  it("el portal usa el título cargado por el comercio (con el nombre público si no lo nombra) o «<nombre público> · Cartas»", () => {
    expect(tituloDelPortal("Nuestras sucursales", NOMBRE_VALIDO)).toBe("Nuestras sucursales · Empresa B");
    expect(tituloDelPortal("Bienvenidos a Empresa B", NOMBRE_VALIDO)).toBe("Bienvenidos a Empresa B");
    expect(tituloDelPortal("", NOMBRE_VALIDO)).toBe("Empresa B · Cartas");
    expect(tituloDelPortal(null, NOMBRE_VALIDO)).toBe("Empresa B · Cartas");
  });
  it("sin nombre público el título propio del portal queda solo", () => {
    expect(tituloDelPortal("Nuestras sucursales", null)).toBe("Nuestras sucursales");
    expect(tituloDelPortal("Nuestras sucursales")).toBe("Nuestras sucursales");
  });
  it("ninguno menciona el nombre de la aplicación", () => {
    for (const t of [tituloDeCartaDeSucursal("X", NOMBRE_VALIDO), tituloDeCartaDeSucursal("X"), tituloDelPortal(null, NOMBRE_VALIDO), tituloDelPortal(null), tituloDelPortal("Y")]) expect(t).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });
});

describe("descripciones", () => {
  it("sin descripción propia: «Carta de <nombre> — <nombre público>.» y las secciones", () => {
    expect(descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", nombreEmpresa: NOMBRE_VALIDO, secciones: ["Entradas", "Platos", "Postres"] })).toBe("Carta de El Pirquinero — Empresa B. Entradas, Platos, Postres.");
  });
  it("sin secciones: solo el encabezado", () => {
    expect(descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", nombreEmpresa: NOMBRE_VALIDO, secciones: [] })).toBe("Carta de El Pirquinero — Empresa B.");
    expect(descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", secciones: [] })).toBe("Carta de El Pirquinero.");
  });
  it("con descripción propia del comercio, esa (con o sin nombre público)", () => {
    expect(descripcionDeCartaDeSucursal({ nombre: "X", nombreEmpresa: NOMBRE_VALIDO, descripcionPropia: "  Cocina   patagónica de autor.  ", secciones: ["A"] })).toBe("Cocina patagónica de autor.");
    expect(descripcionDeCartaDeSucursal({ nombre: "X", descripcionPropia: "Cocina patagónica de autor.", secciones: ["A"] })).toBe("Cocina patagónica de autor.");
  });
  it("nunca pasa de 160, ni con muchas secciones ni con una descripción propia enorme", () => {
    const muchas = Array.from({ length: 40 }, (_, i) => `Sección número ${i}`);
    const d = descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", nombreEmpresa: NOMBRE_VALIDO, secciones: muchas });
    expect(d.length).toBeLessThanOrEqual(LARGO_MAXIMO_DESCRIPCION_PUBLICA);
    expect(d.endsWith("…")).toBe(true);
    expect(descripcionDeCartaDeSucursal({ nombre: "X", descripcionPropia: "a".repeat(500), secciones: [] }).length).toBeLessThanOrEqual(LARGO_MAXIMO_DESCRIPCION_PUBLICA);
  });
  it("el portal lista las sucursales (singular con una sola) y sin sucursales cae en la frase neutra", () => {
    expect(descripcionDelPortal(["Centro", "Costa"], NOMBRE_VALIDO)).toBe("Cartas de Empresa B: Centro, Costa.");
    expect(descripcionDelPortal(["Centro"], NOMBRE_VALIDO)).toBe("Carta de Empresa B: Centro.");
    expect(descripcionDelPortal([], NOMBRE_VALIDO)).toBe("Cartas de Empresa B.");
    expect(descripcionDelPortal(["Centro"])).toBe("Carta: Centro.");
    expect(descripcionDelPortal([])).toBe("Cartas.");
  });
  it("ninguna menciona el nombre de la aplicación", () => {
    for (const d of [descripcionDeCartaDeSucursal({ nombre: "X", nombreEmpresa: NOMBRE_VALIDO, secciones: ["A"] }), descripcionDelPortal(["A", "B"], NOMBRE_VALIDO), descripcionDelPortal([])]) expect(d).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });
});

describe("recortarTexto e imagenParaCompartir", () => {
  it("limpia espacios, no toca lo que entra y corta en límite de palabra", () => {
    expect(recortarTexto("  a   b  ", 10)).toBe("a b");
    expect(recortarTexto("uno dos tres cuatro cinco", 16)).toBe("uno dos tres…");
  });
  it("la imagen para compartir es la del comercio y solo si es https; si no, ninguna (no se inventa)", () => {
    expect(imagenParaCompartir("https://cdn.ejemplo.com/logo.png")).toBe("https://cdn.ejemplo.com/logo.png");
    expect(imagenParaCompartir("http://cdn.ejemplo.com/logo.png")).toBeNull();
    expect(imagenParaCompartir("javascript:alert(1)")).toBeNull();
    expect(imagenParaCompartir("")).toBeNull();
    expect(imagenParaCompartir(null)).toBeNull();
  });
});

describe("origenPublicoDeCarta", () => {
  it("<empresa>.<dominio base> por https", () => {
    expect(origenPublicoDeCarta("carta.ejemplo.com.ar", undefined, "hotel")).toBe("https://hotel.carta.ejemplo.com.ar");
  });
  it("con el add-on de empresa única, el dominio base pelado; con otra empresa, su subdominio", () => {
    expect(origenPublicoDeCarta("carta.ejemplo.com.ar", "hotel", "hotel")).toBe("https://carta.ejemplo.com.ar");
    expect(origenPublicoDeCarta("carta.ejemplo.com.ar", "hotel", "otra")).toBe("https://otra.carta.ejemplo.com.ar");
  });
  it("en localhost/*.localhost, http (sin certificado); sin dominio base, null (solo hay ruta técnica)", () => {
    expect(origenPublicoDeCarta("carta.localhost", undefined, "e2e")).toBe("http://e2e.carta.localhost");
    expect(origenPublicoDeCarta(undefined, undefined, "e2e")).toBeNull();
    expect(origenPublicoDeCarta("  ", undefined, "e2e")).toBeNull();
  });
});
