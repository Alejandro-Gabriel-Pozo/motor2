import { describe, expect, it } from "vitest";
import { conDefaultsDeLaMaqueta, DEFAULTS_DEL_LIBRO_MAQUETA } from "../../src/core/carta/libro-estilo-maqueta";
import { rgbDeColorCss } from "../../src/core/carta/color-css";
import { resolverEstiloCarta } from "../../src/core/carta/estilo";
import {
  CLAVES_TEMA_SIMPLE,
  PALETAS_DE_MARCA,
  TEMA_SIMPLE_VISIBLE,
  eleccionDeLaMarca,
  marcaDeLaEleccion,
  mezclarTemaSimple,
  mismoContenido,
} from "../../src/core/carta/tema-simple";
import { CLAVES_TEMA_V1 } from "../../src/core/carta/tema";
import { guardComandoGuardarTemaSimpleCarta } from "../../src/core/features/carta/tema.guard";
import { temaSimpleVisible } from "../../src/lib/tema-simple-visible";
import { CLAVES_POR_DESTINO, EXTREMOS, PALETAS_ESPERADAS, TODO_LO_AJENO_CARGADO, ALGO_AJENO_CARGADO, contrasteWcag, hexACanales } from "./tema-simple.oraculo";

/**
 * Pantalla simple del Tema de la carta, parte PURA (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`): el guardián de las 65 claves, el interruptor, el texto en colores fijos
 * (paleta por defecto, las seis paletas y trece extremos: ningún texto o ícono bajo 7:1, sin depender de la marca), la mezcla («lo cargado manda») y el guard del guardado simple. Las reglas esperadas están en `tema-simple.oraculo.ts`, escritas aparte.
 */

describe("guardián: cada clave del Tema declara si es de la pantalla simple o está escondida", () => {
  const todas = CLAVES_TEMA_V1.map((d) => d.clave);
  const declaradas = Object.values(CLAVES_POR_DESTINO).flat();

  it("las 65 claves del catálogo están declaradas, una sola vez cada una, y no sobra ninguna", () => {
    expect(todas).toHaveLength(65);
    expect(new Set(declaradas).size).toBe(declaradas.length);
    expect([...declaradas].sort()).toEqual([...todas].sort());
  });

  it("si aparece una clave NUEVA en el catálogo sin declarar, el guardián la nombra", () => {
    const conNueva = [...todas, "clave_nueva_sin_declarar"];
    expect(conNueva.filter((c) => !declaradas.includes(c))).toEqual(["clave_nueva_sin_declarar"]);
  });

  it("la pantalla simple tiene exactamente las siete declaradas SIMPLE, en ese orden; 53 se derivan, 4 quedan pendientes y 1 escondida", () => {
    expect([...CLAVES_TEMA_SIMPLE]).toEqual([...CLAVES_POR_DESTINO.SIMPLE]);
    expect(CLAVES_POR_DESTINO.SIMPLE).toHaveLength(7);
    expect(CLAVES_POR_DESTINO.DERIVADA).toHaveLength(53);
    expect(CLAVES_POR_DESTINO.PENDIENTE).toEqual(["restaurante_subtitulo", "restaurante_descripcion", "hero_etiqueta_superior", "hero_imagen_fondo_url"]);
    expect(CLAVES_POR_DESTINO.ESCONDIDA).toEqual(["carta_fuente_familia"]);
  });
});

describe("interruptor: nace apagado y solo la variable de prueba (con el valor exacto) lo enciende", () => {
  it("la constante está en false y, sin variable, la pantalla simple no se ve", () => {
    expect(TEMA_SIMPLE_VISIBLE).toBe(false);
    expect(temaSimpleVisible({})).toBe(false);
  });

  it.each(["", "1", "SI", "Si", "true", "no", " si", "si "])("la variable con %j NO lo enciende (todo nace cerrado)", (valor) => {
    expect(temaSimpleVisible({ MOTOR2_PRUEBAS_TEMA_SIMPLE: valor })).toBe(false);
  });

  it("con el valor exacto «si» (solo para el e2e y las capturas) se enciende", () => {
    expect(temaSimpleVisible({ MOTOR2_PRUEBAS_TEMA_SIMPLE: "si" })).toBe(true);
  });
});

describe("las seis paletas son las de Pedernal y la elección se traduce de ida y vuelta", () => {
  it("paletas: Azul, Verde, Bordó, Tostado, Negro, Violeta, con sus hex", () => {
    expect(Object.fromEntries(PALETAS_DE_MARCA.map((p) => [p.id, p.hex]))).toEqual(PALETAS_ESPERADAS);
    expect(PALETAS_DE_MARCA.map((p) => p.nombre)).toEqual(["Azul", "Verde", "Bordó", "Tostado", "Negro", "Violeta"]);
  });

  it("marcaDeLaEleccion: la paleta da su hex, «otro» da lo escrito (recortado) y cualquier otra cosa da vacío", () => {
    expect(marcaDeLaEleccion("azul", "")).toBe("#1f4e79");
    expect(marcaDeLaEleccion("otro", "  #0e7490 ")).toBe("#0e7490");
    for (const raro of ["ninguna", "", "rojo", undefined, null, 5, "__proto__"]) expect(marcaDeLaEleccion(raro, "#0e7490")).toBe("");
    expect(marcaDeLaEleccion("otro", 7)).toBe("");
  });

  it("eleccionDeLaMarca: vacío es «ninguna», una paleta (en cualquier mayúscula) es su id y lo demás es «otro» con el texto a la vista", () => {
    expect(eleccionDeLaMarca("")).toEqual({ eleccion: "ninguna", otro: "" });
    expect(eleccionDeLaMarca("#1F4E79")).toEqual({ eleccion: "azul", otro: "" });
    expect(eleccionDeLaMarca("#0e7490")).toEqual({ eleccion: "otro", otro: "#0e7490" });
    expect(eleccionDeLaMarca("rgb(1, 2, 3)")).toEqual({ eleccion: "otro", otro: "rgb(1, 2, 3)" });
  });
});

describe("texto e íconos en colores FIJOS: con cualquier color de marca, nada queda bajo 7:1 sobre el fondo oscuro, y lo guardado es lo elegido (dueño, 2026-11-17: «Ve como un pedernal.»)", () => {
  const POR_DEFECTO = DEFAULTS_DEL_LIBRO_MAQUETA.color_marca!;
  const CASOS: ReadonlyArray<readonly [string, string]> = [
    ["la marca por defecto de la maqueta", POR_DEFECTO],
    ...Object.entries(PALETAS_ESPERADAS).map(([nombre, hex]) => [`paleta ${nombre}`, hex] as const),
    ...EXTREMOS.map((hex) => [`extremo ${hex}`, hex] as const),
  ];
  const SIN_MARCA = resolverEstiloCarta(conDefaultsDeLaMaqueta({ marca_derivada: "oscura" }));
  /** Todo lo que la carta pinta como TEXTO o ÍCONO con las variables del sistema, ya resuelto, sin la marca. */
  const fijos = (e: ReturnType<typeof resolverEstiloCarta>) => ({
    tinta: e.tintaBase,
    textoDeMarca: e.variablesCss["--carta-primary-texto"],
    flechas: e.colores.navFlechas,
    iconos: e.colores.navIconos,
    invitacion: e.portada.colorCta,
    textoPortada: e.portada.colorTexto,
    selloTexto: e.variablesCss["--carta-sello-texto"],
    selloFondo: e.variablesCss["--carta-sello-fondo"],
  });

  it("son 1 + 6 + 13 colores", () => {
    expect(CASOS).toHaveLength(20);
  });

  describe.each(CASOS)("%s", (_nombre, elegido) => {
    const guardado = { color_marca: elegido, marca_derivada: "oscura" };
    const copiaDeLoGuardado = JSON.stringify(guardado);
    const estilo = resolverEstiloCarta(conDefaultsDeLaMaqueta(guardado));
    const fondo = rgbDeColorCss(estilo.valores.color_fondo_dia)!;

    it("el fondo del sistema es oscuro y cada texto e ícono de la carta llega a 7:1 sobre él (también la tinta atenuada, medida en sRGB)", () => {
      expect(contrasteWcag(fondo, [255, 255, 255])).toBeGreaterThan(7);
      const tinta = rgbDeColorCss(estilo.tintaBase!)!;
      expect(contrasteWcag(tinta, fondo)).toBeGreaterThanOrEqual(7);
      const atenuada: [number, number, number] = [0, 1, 2].map((i) => tinta[i]! * 0.7 + fondo[i]! * 0.3) as [number, number, number];
      expect(contrasteWcag(atenuada, fondo)).toBeGreaterThanOrEqual(7);
      // Las flechas, los íconos de redes y la invitación de la portada: colores explícitos (no la marca) y a 7:1.
      for (const color of [estilo.colores.navFlechas, estilo.colores.navIconos, estilo.portada.colorCta]) {
        expect(color).toBeTruthy();
        expect(contrasteWcag(rgbDeColorCss(color!)!, fondo)).toBeGreaterThanOrEqual(7);
      }
      // Todo texto que sin marcador se pintaba con la marca pasa a la tinta; la letra del sello también (el aro es el único uso de la marca).
      expect(estilo.variablesCss["--carta-primary-texto"]).toBe("var(--carta-ink)");
      expect(estilo.variablesCss["--carta-sello-texto"]).toBe("var(--carta-ink)");
      expect(estilo.variablesCss["--carta-sello-fondo"]).toBe("var(--carta-bg)");
    });

    it("el color de marca NO cambia ningún color de texto o ícono: son idénticos a los de una carta sin marca", () => {
      expect(fijos(estilo)).toEqual(fijos(SIN_MARCA));
    });

    it("la marca se muestra TAL CUAL la eligió la empresa (sin ajuste de luminosidad) y lo guardado no se toca", () => {
      expect(estilo.valores.color_marca).toBe(elegido);
      expect(JSON.stringify(guardado)).toBe(copiaDeLoGuardado);
      expect(mezclarTemaSimple({}, { color_marca: elegido }).color_marca).toBe(elegido);
    });
  });

  it("DECLARADO, no rechazado: como acento (arco y aro de la portada, bordes) la marca puede quedar bajo 3:1 contra el fondo (los colores muy oscuros, como el negro o el fondo mismo); la carta no la rechaza ni la ajusta", () => {
    const fondo = hexACanales(DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia!);
    const flojos = CASOS.filter(([, hex]) => contrasteWcag(hexACanales(hex), fondo) < 3).map(([, hex]) => hex);
    expect(flojos).toEqual(expect.arrayContaining(["#000000", "#0a0a0a", "#19191a", "#000033"]));
    for (const hex of flojos) expect(resolverEstiloCarta(conDefaultsDeLaMaqueta({ color_marca: hex, marca_derivada: "oscura" })).valores.color_marca).toBe(hex);
    expect(flojos).not.toContain("#ffffff");
    expect(flojos).not.toContain("#ffff00");
  });

  it("sin el marcador «oscura» el resolvedor NO cambia nada (la carta de hoy sale igual)", () => {
    for (const hex of ["#1f4e79", "#ffffff", "#000000"]) {
      expect(resolverEstiloCarta({ color_marca: hex }).valores.color_marca).toBe(hex);
      expect(resolverEstiloCarta({ color_marca: hex, marca_derivada: "si" }).valores.color_marca).toBe(hex);
      expect(resolverEstiloCarta({ color_marca: hex }).variablesCss["--carta-sello-fondo"]).toBeUndefined();
    }
  });

  it("«si» (fondo claro, ya cargado por algunas empresas) sigue significando lo mismo: no deriva el fondo oscuro", () => {
    expect(resolverEstiloCarta({ color_marca: "#1f4e79", marca_derivada: "si" }).valores.color_fondo_dia).toBe("");
    expect(resolverEstiloCarta({ color_marca: "#1f4e79", marca_derivada: "oscura" }).valores.color_fondo_dia).toBe(DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia);
  });

  it("lo cargado manda: un fondo propio de la empresa se respeta (no se pisa con el oscuro del sistema) y la marca sigue tal cual", () => {
    const estilo = resolverEstiloCarta({ color_marca: "#1f4e79", marca_derivada: "oscura", color_fondo_dia: "#222222" });
    expect(estilo.valores.color_fondo_dia).toBe("#222222");
    expect(estilo.valores.color_marca).toBe("#1f4e79");
  });

  it("un fondo cargado que no se puede leer (un nombre CSS) falla cerrado: manda el oscuro del sistema", () => {
    expect(resolverEstiloCarta({ color_marca: "#1f4e79", marca_derivada: "oscura", color_fondo_dia: "red" }).valores.color_fondo_dia).toBe(DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia);
  });

  it("sin color de marca, el marcador solo deriva el fondo oscuro: no inventa ninguna marca", () => {
    const estilo = resolverEstiloCarta({ marca_derivada: "oscura" });
    expect(estilo.valores.color_marca).toBe("");
    expect(estilo.valores.color_fondo_dia).toBe(DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia);
  });

  it("una marca guardada que no se puede leer (un nombre CSS) falla cerrado: sin marca", () => {
    expect(resolverEstiloCarta({ color_marca: "red", marca_derivada: "oscura" }).valores.color_marca).toBe("");
  });

  it("con un fondo de portada propio, el texto de la portada lo decide ese fondo y no la marca", () => {
    const estilo = resolverEstiloCarta({ color_marca: "#1f4e79", marca_derivada: "oscura", hero_color_fondo: "#ffffff" });
    expect(estilo.portada.colorTexto).toBe("oklch(0.18 0.02 40)");
  });
});

describe("mezclarTemaSimple: «lo cargado manda»", () => {
  it("cambia solo las siete claves y conserva todas las demás (incluidas las que el catálogo no conoce y las mal cargadas), sin tocar el original", () => {
    const guardado = { ...TODO_LO_AJENO_CARGADO, clave_vieja: "x", color_item_precio: "no es un color;", restaurante_nombre: "Viejo", marca_derivada: "si" };
    const copia = JSON.stringify(guardado);
    const mezcla = mezclarTemaSimple(guardado, { color_marca: "#1f4e79", restaurante_nombre: "Nuevo" });
    expect(JSON.stringify(guardado)).toBe(copia);
    expect(mezcla.restaurante_nombre).toBe("Nuevo");
    expect(mezcla.color_marca).toBe("#1f4e79");
    expect(mezcla.marca_derivada).toBe("oscura");
    for (const [k, v] of Object.entries(guardado)) if (!CLAVES_POR_DESTINO.SIMPLE.includes(k) && k !== "marca_derivada") expect(mezcla[k], k).toBe(v);
  });

  it("una de las siete que viene vacía o ausente se saca (vacío = default de la carta)", () => {
    const mezcla = mezclarTemaSimple({ color_marca: "#1f4e79", marca_derivada: "oscura", restaurante_logo_url: "https://x.com/l.png", restaurante_nombre: "A" }, { color_marca: "#1f4e79", restaurante_nombre: "" });
    expect(mezcla).toEqual({ color_marca: "#1f4e79", marca_derivada: "oscura" });
  });

  it("sin color de marca el marcador se va (el marcador significa «hay una marca»)", () => {
    expect(mezclarTemaSimple({ color_marca: "#1f4e79", marca_derivada: "si", hero_ink: "claro" }, {})).toEqual({ hero_ink: "claro" });
  });

  it("de un guardado que no es un objeto (null, lista, texto) parte de vacío", () => {
    for (const raro of [null, undefined, [], "x", 3]) expect(mezclarTemaSimple(raro, { restaurante_nombre: "A" })).toEqual({ restaurante_nombre: "A" });
  });

  it("algunas ajenas cargadas pasan intactas", () => {
    const mezcla = mezclarTemaSimple(ALGO_AJENO_CARGADO, { color_marca: "#17562f" });
    expect(mezcla).toEqual({ ...ALGO_AJENO_CARGADO, color_marca: "#17562f", marca_derivada: "oscura" });
  });

  it("mismoContenido: sin importar el orden de las claves; distingue un valor, una clave de más y un tipo", () => {
    expect(mismoContenido({ a: "1", b: { c: ["x", "y"] } }, { b: { c: ["x", "y"] }, a: "1" })).toBe(true);
    expect(mismoContenido({ a: "1" }, { a: "2" })).toBe(false);
    expect(mismoContenido({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(mismoContenido({ a: "1" }, { a: 1 })).toBe(false);
    expect(mismoContenido({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(mismoContenido({}, [])).toBe(false);
  });
});

describe("guard del guardado simple: solo las siete claves, sin regla de contraste", () => {
  const ENTRADA = { sucursalId: "s1", sucursalActivaId: "s1", versionEsperada: "sin-tema" };
  const guard = (valores: Record<string, unknown>, extra: Partial<typeof ENTRADA & { versionEsperada: unknown }> = {}) => guardComandoGuardarTemaSimpleCarta({ ...ENTRADA, ...extra, valores });

  it("acepta las siete, normaliza (mayúsculas del color, el @ del usuario, teléfono, nombre recortado) e ignora cualquier otra clave", () => {
    const r = guard({
      color_marca: "#1F4E79",
      restaurante_logo_url: "https://cdn.example.com/logo.png",
      restaurante_nombre: "  La Parrilla ",
      restaurante_instagram: "@laparrilla",
      restaurante_facebook: "laparrilla",
      restaurante_whatsapp: "+54 9 294 123-4567",
      restaurante_footer_maps_url: "https://maps.app.goo.gl/x",
      hero_ink: "claro;DROP",
      precio_simbolo: "US$",
      clave_cualquiera: "x",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.valores).toEqual({
        color_marca: "#1f4e79",
        restaurante_logo_url: "https://cdn.example.com/logo.png",
        restaurante_nombre: "La Parrilla",
        restaurante_instagram: "laparrilla",
        restaurante_facebook: "laparrilla",
        restaurante_whatsapp: "5492941234567",
        restaurante_footer_maps_url: "https://maps.app.goo.gl/x",
      });
    }
  });

  it("NO rechaza por contraste: blanco, negro y amarillo claro pasan (la carta no ajusta la marca)", () => {
    for (const hex of ["#ffffff", "#000000", "#ffff99", "#19191a"]) expect(guard({ color_marca: hex }).ok, hex).toBe(true);
  });

  it.each(["red", "#fff", "rgb(1, 2, 3)", "oklch(0.5 0.1 30)", "#12345", "#1234567", "1f4e79", "claro", "#12345g"])("el color de marca %j (no es #rrggbb) se rechaza con el formato a la vista", (malo) => {
    const r = guard({ color_marca: malo });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/Color de marca|Revisá/);
  });

  it.each([
    ["restaurante_instagram", "javascript:alert(1)"],
    ["restaurante_instagram", "https://evil.com/x"],
    ["restaurante_facebook", "https://evil.com/x"],
    ["restaurante_whatsapp", "abc"],
    ["restaurante_footer_maps_url", "javascript:alert(1)"],
    ["restaurante_footer_maps_url", "http://maps.app.goo.gl/x"],
    ["restaurante_logo_url", "http://x.com/logo.png"],
    ["restaurante_nombre", "x".repeat(121)],
    ["restaurante_nombre", "con\nsalto"],
  ])("contacto, logo y nombre: %s = %j se rechaza", (clave, valor) => {
    expect(guard({ [clave]: valor }).ok).toBe(false);
  });

  it("los vacíos y los espacios no son errores: quedan fuera del comando (se sacan al mezclar)", () => {
    const r = guard({ color_marca: "", restaurante_nombre: "   ", restaurante_logo_url: null });
    expect(r.ok && r.valor.valores).toEqual({});
  });

  it("otra sucursal que la activa responde como una inexistente", () => {
    const r = guard({ color_marca: "#1f4e79" }, { sucursalId: "otra" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.mensaje).toBe("No se encontró la sucursal.");
  });

  it.each([undefined, null, 5, "", "ayer", "2026-11-17", "2026-11-17T10:00:00Z", "SIN-TEMA", "sin-tema ", "2026-11-17T10:00:00.000+00:00"])("la versión %j no es ni «sin-tema» ni una fecha ISO con milisegundos: se rechaza", (version) => {
    expect(guard({ color_marca: "#1f4e79" }, { versionEsperada: version as never }).ok).toBe(false);
  });

  it("acepta una versión ISO con milisegundos", () => {
    expect(guard({ color_marca: "#1f4e79" }, { versionEsperada: "2026-11-17T10:00:00.123Z" }).ok).toBe(true);
  });
});
