import { describe, expect, it } from "vitest";
import { colorDelPortal, eleccionDeFondo, estiloDelPortalSimple, fondoDeLaEleccion, PALETAS_DEL_PORTAL, sembrarTarjetasDelPortal, type RegistroPublicoParaSembrar } from "../../src/core/carta/public";
import { guardComandoGuardarColoresDelPortal } from "../../src/core/features/carta/portal-colores.guard";
import { portalSimpleVisible } from "../../src/lib/portal-simple-visible";

/** «Colores del portal»: lo puro (el color a usar, la elección de la pantalla, el sembrado desde lo cargado, el guard y la lectura que no cambia lo que se ve hoy). */
const NUEVO = { variante: "A", lineaSuperior: null, titulo: null, colorEncabezado: null, colorPagina: null, colorDetras: null, imagen: null, logoVisible: true } as const;
const registro = (extra: Partial<RegistroPublicoParaSembrar> = {}): RegistroPublicoParaSembrar => ({ sucursalId: "s1", publicada: true, activa: true, orden: 0, etiqueta: null, posX: null, posY: null, posW: null, posH: null, ...extra });

describe("interruptor", () => {
  it("nace APAGADO (todo nace cerrado)", () => {
    expect(portalSimpleVisible()).toBe(false);
    expect(portalSimpleVisible("1")).toBe(false); // la cookie sola no alcanza fuera del servidor de los e2e
  });
});

describe("colorDelPortal", () => {
  it("falla cerrado: lo que no es #rrggbb da null (mayúsculas sí se aceptan)", () => {
    for (const malo of [null, undefined, 12, "azul", "#fff", "#12345", "#1234567", "rgb(0,0,0)", "#gggggg", ""]) expect(colorDelPortal(malo), String(malo)).toBeNull();
    expect(colorDelPortal("#1F4E79")?.hex).toBe("#1f4e79");
  });
  it("las seis paletas de Pedernal se leen tal cual (no se ajustan) y su texto es blanco", () => {
    for (const p of PALETAS_DEL_PORTAL) expect(colorDelPortal(p.hex), p.nombre).toMatchObject({ hex: p.hex, ajustado: false, texto: "#ffffff" });
  });
  it("la elección de la pantalla ida y vuelta: paleta, otro color, sin color y basura", () => {
    expect(fondoDeLaEleccion(PALETAS_DEL_PORTAL[0].hex, "")).toBe("#1f4e79");
    expect(fondoDeLaEleccion("otro", "  #AABBCC ")).toBe("#AABBCC");
    expect(fondoDeLaEleccion("ninguna", "#aabbcc")).toBe("");
    expect(fondoDeLaEleccion("cualquier-cosa", "#aabbcc")).toBe("");
    expect(eleccionDeFondo(null)).toEqual({ eleccion: "ninguna", otro: "" });
    expect(eleccionDeFondo("#17562F")).toEqual({ eleccion: "#17562f", otro: "" });
    expect(eleccionDeFondo("#123456")).toEqual({ eleccion: "otro", otro: "#123456" });
  });
});

describe("estiloDelPortalSimple: crear la fila no cambia lo que se ve (lo cargado manda)", () => {
  const json = { portal_header_bg: "#112233", portal_fondo_color: "#fafafa", portal_etiqueta: "Desde el Json", portal_titulo: "Título del Json", portal_card_bg: "#223344" };
  it("una fila VACÍA con la pantalla simple da el mismo estilo que el Json solo (sin ajustar nada: no hay fondo elegido)", () => {
    const sin = estiloDelPortalSimple(json, NUEVO);
    expect(sin.valores.portal_header_bg).toBe("#112233");
    expect(sin.valores.portal_fondo_color).toBe("#fafafa");
    expect(sin.valores.portal_etiqueta).toBe("Desde el Json");
    expect(sin.valores.portal_titulo).toBe("Título del Json");
    expect(sin.valores.portal_card_bg).toBe("#223344");
  });
  it("sin Json y sin fondos: el estilo por defecto", () => {
    expect(estiloDelPortalSimple(null, NUEVO).variablesCss).toEqual(estiloDelPortalSimple({}, NUEVO).variablesCss);
  });
  it("un fondo de la fila pisa el del Json y deriva sus textos; los otros dos grupos siguen como el Json", () => {
    const e = estiloDelPortalSimple(json, { ...NUEVO, colorEncabezado: "#ffffff" });
    expect(e.valores.portal_header_bg).toBe("#ffffff");
    expect(e.valores.portal_titulo_color).toBe("#000000");
    expect(e.valores.portal_fondo_color).toBe("#fafafa");
    expect(e.valores.portal_card_bg).toBe("#223344");
  });
  it("el fondo de la página fija la variable del texto que cae directo sobre ella", () => {
    expect(estiloDelPortalSimple({}, { ...NUEVO, colorPagina: "#ffffff" }).variablesCss["--portal-pagina-color"]).toBe("#000000");
    expect(estiloDelPortalSimple({}, NUEVO).variablesCss["--portal-pagina-color"]).toBeUndefined();
  });
});

describe("sembrarTarjetasDelPortal (el riesgo «portal vacío al crear la fila»)", () => {
  it("una tarjeta por cada registro público: visible = publicada, nombre = etiqueta (vacía = null), orden el suyo", () => {
    const r = sembrarTarjetasDelPortal({ valoresJson: {}, registros: [registro({ sucursalId: "a", orden: 2, etiqueta: "Centro" }), registro({ sucursalId: "b", orden: 1, publicada: false, etiqueta: "  " })] });
    expect(r).toEqual({
      ok: true,
      tarjetas: [
        { sucursalId: "a", orden: 2, visible: true, nombre: "Centro", telefono: null, foto: null },
        { sucursalId: "b", orden: 1, visible: false, nombre: null, telefono: null, foto: null },
      ],
    });
  });
  it("sin registros públicos: sin tarjetas (el portal ya se veía vacío)", () => {
    expect(sembrarTarjetasDelPortal({ valoresJson: {}, registros: [] })).toEqual({ ok: true, tarjetas: [] });
  });
  it("un orden negativo se corre todo lo mismo (la tarjeta pide >= 0) y se conserva el orden relativo", () => {
    const r = sembrarTarjetasDelPortal({ valoresJson: {}, registros: [registro({ sucursalId: "a", orden: -2 }), registro({ sucursalId: "b", orden: 3 })] });
    expect(r.ok && r.tarjetas.map((t) => t.orden)).toEqual([0, 5]);
  });
  it("si HOY es un mapa (imagen y sucursal ubicada) NO se siembra: se niega con el motivo", () => {
    const r = sembrarTarjetasDelPortal({ valoresJson: { portal_bg_image_url: "https://res.cloudinary.com/x/image/upload/v1/a.jpg" }, registros: [registro({ posX: 10, posY: 10, posW: 20 })] });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.mensaje).toContain("mapa");
  });
  it("una imagen sin sucursales ubicadas es una lista (como se ve hoy): se siembra", () => {
    expect(sembrarTarjetasDelPortal({ valoresJson: { portal_bg_image_url: "https://res.cloudinary.com/x/image/upload/v1/a.jpg" }, registros: [registro()] }).ok).toBe(true);
  });
  it("una etiqueta que no entra en una tarjeta cierra (no se cambia el nombre que se ve)", () => {
    const r = sembrarTarjetasDelPortal({ valoresJson: {}, registros: [registro({ etiqueta: "x".repeat(200) })] });
    expect(r.ok).toBe(false);
  });
});

describe("guard del pedido", () => {
  const base = { colorEncabezado: "#1F4E79", colorPagina: "", colorDetras: null, lineaSuperior: "Nuestros restaurantes", titulo: "", logoVisible: true };
  it("normaliza (colores en minúsculas, vacío = null) y deja pasar un color que no se lee: se ajusta al mostrar, no se rechaza", () => {
    const r = guardComandoGuardarColoresDelPortal({ ...base, colorPagina: "#808080" });
    expect(r).toMatchObject({ ok: true, valor: { colorEncabezado: "#1f4e79", colorPagina: "#808080", colorDetras: null, titulo: null, imagen: undefined, versionEsperada: undefined } });
  });
  it("falla cerrado: solo se permite lo declarado (forma del color, largos, proveedor de imagen, versión entera positiva)", () => {
    const malos: unknown[] = [null, "texto", [], { ...base, logoVisible: "si" }, { ...base, colorEncabezado: "azul" }, { ...base, colorDetras: "#12345" }, { ...base, lineaSuperior: "x".repeat(41) }, { ...base, titulo: "x".repeat(61) }, { ...base, titulo: "<b>hola</b>" }, { ...base, imagen: "https://evil.com/x.png" }, { ...base, versionEsperada: 0 }, { ...base, versionEsperada: 1.5 }, { ...base, versionEsperada: "1" }];
    for (const m of malos) expect(guardComandoGuardarColoresDelPortal(m).ok, JSON.stringify(m)).toBe(false);
  });
  it("ignora lo que el navegador cuela (empresa, variante, tarjetas, código): el pedido solo trae lo de la pantalla", () => {
    const r = guardComandoGuardarColoresDelPortal({ ...base, empresaId: "otra", variante: "B", tarjetas: [{}], codigo: "x" });
    expect(r.ok && Object.keys(r.valor).sort()).toEqual(["colorDetras", "colorEncabezado", "colorPagina", "imagen", "lineaSuperior", "logoVisible", "titulo", "versionEsperada"]);
  });
});
