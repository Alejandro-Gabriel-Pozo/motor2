import { describe, expect, it } from "vitest";
import {
  centesimasDesdeTexto,
  esCodigoDePortalValido,
  esColorDePortalValido,
  esTelefonoDeTarjetaValido,
  generarCodigoDePortal,
  leerDireccionDeImagen,
  lineaDelPortalDesdeTexto,
  sonPartesDeImagenValidas,
  textoDesdeCentesimas,
  tituloDelPortalDesdeTexto,
  urlDeImagenExterna,
  zonaDentroDeLaImagen,
} from "../../src/core/carta/public";
import { guardComandoGuardarPortalDeEmpresa } from "../../src/core/features/carta/portal-de-empresa.guard";
import type { FuenteDeAzar } from "../../src/core/seguridad/azar";

/**
 * Dominio PURO del portal de la empresa (PR-A): la imagen por dirección externa (partes de la lista cerrada), el código del QR (128 bits, forma validada antes de consultar), el teléfono solo con dígitos, los colores, los porcentajes de las zonas y el guard del pedido.
 * Todo por lista de permitidos. Sin base de datos: la prueba espejo contra los CHECK de Postgres está en `test/aislamiento/portal-de-empresa-subir-bajar-subir.test.ts`.
 */

const azarFijo = (bytes: number[]): FuenteDeAzar => ({ bytes: (n) => Uint8Array.from({ length: n }, (_, i) => bytes[i % bytes.length]!), entero: () => 0, uuid: () => "00000000-0000-4000-8000-000000000000" });
const DIRECCION = "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/carta/portal/fondo.jpg";
const PARTES = { proveedor: "CLOUDINARY", cuenta: "mi-cuenta", idPublico: "carta/portal/fondo", version: "1700000000", extension: "jpg" } as const;

describe("el código del QR", () => {
  it("tiene 22 caracteres de [A-Za-z0-9_-] (128 bits), sale de la fuente de azar que se le pasa y cambia con ella", () => {
    const a = generarCodigoDePortal(azarFijo([0, 0, 0, 0]));
    const b = generarCodigoDePortal(azarFijo([255]));
    expect(a).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    expect(b).toBe("_____________________w");
    for (const c of [a, b]) {
      expect(c).toHaveLength(22);
      expect(esCodigoDePortalValido(c)).toBe(true);
    }
    expect(generarCodigoDePortal(azarFijo([1, 2, 3, 4, 5, 6, 7]))).toBe(generarCodigoDePortal(azarFijo([1, 2, 3, 4, 5, 6, 7])));
  });

  it("128 bits: 16 bytes distintos dan códigos distintos (se recorren 2000 al azar real sin repetir)", () => {
    const real: FuenteDeAzar = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)), entero: () => 0, uuid: () => crypto.randomUUID() };
    const vistos = new Set(Array.from({ length: 2000 }, () => generarCodigoDePortal(real)));
    expect(vistos.size).toBe(2000);
  });

  it("la forma se valida ANTES de consultar (como `esSlugPublicoValido`): solo 22 a 64 de [A-Za-z0-9_-]; lo demás ni se busca", () => {
    for (const bueno of ["a".repeat(22), "A-_9".repeat(16), "x".repeat(64)]) expect(esCodigoDePortalValido(bueno), bueno).toBe(true);
    for (const malo of ["", "a".repeat(21), "a".repeat(65), `${"a".repeat(21)}.`, `${"a".repeat(21)}/`, `${"a".repeat(21)} `, `${"a".repeat(21)}%`, `${"a".repeat(21)}ñ`, `${"a".repeat(21)}\n`, `${"a".repeat(21)}'`, 123, null, undefined, {}]) {
      expect(esCodigoDePortalValido(malo), String(malo)).toBe(false);
    }
  });
});

describe("la imagen por dirección externa", () => {
  it("lee la dirección completa y la descompone en partes; la dirección que se muestra se vuelve a armar desde la plantilla", () => {
    expect(leerDireccionDeImagen(DIRECCION)).toEqual({ ok: true, valor: PARTES });
    expect(urlDeImagenExterna(PARTES)).toBe(DIRECCION);
  });

  it("tolera blancos, comillas, el esquema o el host en mayúsculas, http y las transformaciones del proveedor (se descartan)", () => {
    expect(leerDireccionDeImagen(`  "${DIRECCION}"\n`)).toMatchObject({ ok: true, valor: PARTES });
    expect(leerDireccionDeImagen("HTTPS://RES.CLOUDINARY.COM/mi-cuenta/image/upload/v1700000000/carta/portal/fondo.JPG")).toMatchObject({ ok: true, valor: PARTES });
    expect(leerDireccionDeImagen("http://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/carta/portal/fondo.jpg")).toMatchObject({ ok: true, valor: PARTES });
    expect(leerDireccionDeImagen("https://res.cloudinary.com/mi-cuenta/image/upload/c_fill,w_300/f_auto/v1700000000/carta/portal/fondo.jpg")).toMatchObject({ ok: true, valor: PARTES });
  });

  it("rechaza todo lo que no es del proveedor permitido: otro host, parecidos, usuario, puerto, IP, consulta, fragmento, `..`, `%`, video, falta de versión, extensión rara, controles y Unicode", () => {
    const base = "/mi-cuenta/image/upload/v1700000000/carta/fondo.jpg";
    const malas = [
      "",
      "   ",
      "res.cloudinary.com/mi-cuenta/image/upload/v1/x.jpg",
      `ftp://res.cloudinary.com${base}`,
      `https://cloudinary.com${base}`,
      `https://res.cloudinary.com.evil.com${base}`,
      `https://evil.com/res.cloudinary.com${base}`,
      `https://res.cloudinary.com.${base}`,
      `https://usuario@res.cloudinary.com${base}`,
      `https://res.cloudinary.com:8080${base}`,
      `https://127.0.0.1${base}`,
      `https://localhost${base}`,
      `https://res.cloudinary.com${base}?x=1`,
      `https://res.cloudinary.com${base}#frag`,
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/../fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/a%2e%2e/fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/video/upload/v1700000000/fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/raw/upload/v1700000000/fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/fetch/v1700000000/fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v0123/fondo.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fondo.gif",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fondo.svg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fondo",
      "https://res.cloudinary.com/MiCuenta/image/upload/v1700000000/fondo.jpg",
      `https://res.cloudinary.com/${"a".repeat(65)}/image/upload/v1700000000/fondo.jpg`,
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fon do.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fondo.jpg\u0000",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fóndo.jpg",
      "https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/fondo\\.jpg",
      `https://res.cloudinary.com/mi-cuenta/image/upload/v1700000000/${"a".repeat(300)}.jpg`,
      `<img src="${DIRECCION}">`,
    ];
    for (const m of malas) expect(leerDireccionDeImagen(m).ok, JSON.stringify(m)).toBe(false);
    for (const noTexto of [null, undefined, 5, {}, ["x"]]) expect(leerDireccionDeImagen(noTexto).ok).toBe(false);
  });

  it("las partes se validan una por una (la misma regla que `imagen_externa_valida` de la base): proveedor de la lista, cuenta, id con tramos, versión de 1 a 12 dígitos sin cero inicial, extensión", () => {
    expect(sonPartesDeImagenValidas(PARTES)).toBe(true);
    expect(sonPartesDeImagenValidas({ ...PARTES, idPublico: "x" })).toBe(true);
    expect(sonPartesDeImagenValidas({ ...PARTES, idPublico: "a".repeat(200) })).toBe(true);
    expect(sonPartesDeImagenValidas({ ...PARTES, version: "999999999999" })).toBe(true);
    for (const malas of [
      { ...PARTES, proveedor: "OTRO" },
      { ...PARTES, cuenta: "" },
      { ...PARTES, cuenta: "Mayus" },
      { ...PARTES, idPublico: "" },
      { ...PARTES, idPublico: "a".repeat(201) },
      { ...PARTES, idPublico: "a//b" },
      { ...PARTES, idPublico: "/a" },
      { ...PARTES, idPublico: "a/" },
      { ...PARTES, idPublico: "a.b" },
      { ...PARTES, version: "0" },
      { ...PARTES, version: "01" },
      { ...PARTES, version: "1234567890123" },
      { ...PARTES, version: "12a" },
      { ...PARTES, extension: "gif" },
      { ...PARTES, extension: "JPG" },
      { ...PARTES, extension: undefined },
      { cuenta: "x" },
      null,
      "x",
    ]) {
      expect(sonPartesDeImagenValidas(malas), JSON.stringify(malas)).toBe(false);
    }
  });
});

describe("textos, colores, teléfono y porcentajes", () => {
  it("la línea superior (1 a 40) y el título (1 a 60) admiten el catálogo y rechazan lo demás", () => {
    expect(lineaDelPortalDesdeTexto("Nuestros restaurantes")).toEqual({ ok: true, valor: "Nuestros restaurantes" });
    expect(tituloDelPortalDesdeTexto("¿Dónde querés comer? 2x1 50% $500")).toMatchObject({ ok: true });
    expect(lineaDelPortalDesdeTexto("a".repeat(41))).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
    expect(lineaDelPortalDesdeTexto("a".repeat(40)).ok).toBe(true);
    expect(tituloDelPortalDesdeTexto("a".repeat(61))).toEqual({ ok: false, error: "DEMASIADO_LARGO" });
    expect(tituloDelPortalDesdeTexto("a".repeat(60)).ok).toBe(true);
    for (const malo of ["<b>hola</b>", "hola\nmundo", "hola​mundo", "=SUMA(1)", "+54 11", "👍", "hola_mundo"]) expect(lineaDelPortalDesdeTexto(malo).ok, malo).toBe(false);
    expect(lineaDelPortalDesdeTexto("   ")).toEqual({ ok: false, error: "VACIO" });
  });

  it("el color es #rrggbb en minúsculas", () => {
    for (const bueno of ["#000000", "#e5dfdf", "#abcdef"]) expect(esColorDePortalValido(bueno)).toBe(true);
    for (const malo of ["#ABCDEF", "#abc", "#abcdeg", "abcdef", "#abcdef ", "transparent", "rgb(0,0,0)", "#abcdef0", "", null, 7]) expect(esColorDePortalValido(malo), String(malo)).toBe(false);
  });

  it("el teléfono de la tarjeta es SOLO DÍGITOS, de 1 a 40 (decisión del dueño, «solo números»)", () => {
    for (const bueno of ["1", "1155551234", "0".repeat(40)]) expect(esTelefonoDeTarjetaValido(bueno), bueno).toBe(true);
    for (const malo of ["", "0".repeat(41), "11 5555 1234", "11-5555", "+5411555512", "(011)5555", "11555a", "１１５５", "1155\n", " 1155", "1155 ", 1155, null]) expect(esTelefonoDeTarjetaValido(malo), String(malo)).toBe(false);
  });

  it("los porcentajes: texto con hasta dos decimales de 0 a 100, en centésimas; ida y vuelta exacta", () => {
    expect(centesimasDesdeTexto("0")).toBe(0);
    expect(centesimasDesdeTexto("12.5")).toBe(1250);
    expect(centesimasDesdeTexto("12.05")).toBe(1205);
    expect(centesimasDesdeTexto("100")).toBe(10000);
    expect(centesimasDesdeTexto("100.00")).toBe(10000);
    for (const malo of ["", "-1", "100.01", "101", "1.234", "1,5", "1e2", " 1", "1 ", ".5", "5.", "abc", "１２"]) expect(centesimasDesdeTexto(malo), malo).toBeNull();
    for (const c of [0, 5, 1205, 1250, 9999, 10000]) expect(centesimasDesdeTexto(textoDesdeCentesimas(c))).toBe(c);
    expect(textoDesdeCentesimas(1250)).toBe("12.50");
  });

  it("una zona tiene que quedar entera dentro de la imagen (x + ancho ≤ 100 e y + alto ≤ 100, ancho y alto > 0)", () => {
    expect(zonaDentroDeLaImagen({ x: 0, y: 0, ancho: 10000, alto: 10000 })).toBe(true);
    expect(zonaDentroDeLaImagen({ x: 9000, y: 9500, ancho: 1000, alto: 500 })).toBe(true);
    expect(zonaDentroDeLaImagen({ x: 9001, y: 0, ancho: 1000, alto: 10 })).toBe(false);
    expect(zonaDentroDeLaImagen({ x: 0, y: 9501, ancho: 10, alto: 500 })).toBe(false);
    expect(zonaDentroDeLaImagen({ x: 0, y: 0, ancho: 0, alto: 10 })).toBe(false);
    expect(zonaDentroDeLaImagen({ x: 0, y: 0, ancho: 10, alto: 0 })).toBe(false);
    expect(zonaDentroDeLaImagen({ x: -1, y: 0, ancho: 10, alto: 10 })).toBe(false);
  });
});

describe("el guard del pedido de guardar el portal", () => {
  const SUC = "sucursal_1";
  const base = { variante: "A", logoVisible: true };
  const ok = (entrada: unknown) => guardComandoGuardarPortalDeEmpresa(entrada);

  it("un pedido mínimo (variante y logo) es válido: todo lo opcional queda vacío (valor por defecto) y la imagen ausente se conserva", () => {
    expect(ok(base)).toEqual({
      ok: true,
      valor: {
        datos: { variante: "A", lineaSuperior: null, titulo: null, colorEncabezado: null, colorPagina: null, colorDetras: null, logoVisible: true },
        imagen: undefined,
        tarjetas: [],
        zonas: [],
        versionEsperada: undefined,
      },
    });
  });

  it("normaliza: texto en blanco = sin él; imagen pegada = partes; imagen vacía o `null` = quitarla; el teléfono y los porcentajes salen limpios", () => {
    const r = ok({
      ...base,
      variante: "B",
      lineaSuperior: "  Nuestros   restaurantes ",
      titulo: "   ",
      colorEncabezado: "#e5dfdf",
      imagen: DIRECCION,
      tarjetas: [{ sucursalId: SUC, orden: 2, visible: true, nombre: "  Centro ", telefono: " 1155551234 ", foto: DIRECCION }],
      zonas: [{ sucursalId: SUC, x: "12.5", y: 10, ancho: "30", alto: "20.25", visible: false }],
      versionEsperada: 3,
    });
    expect(r).toMatchObject({
      ok: true,
      valor: {
        datos: { variante: "B", lineaSuperior: "Nuestros restaurantes", titulo: null, colorEncabezado: "#e5dfdf" },
        imagen: PARTES,
        tarjetas: [{ sucursalId: SUC, orden: 2, visible: true, nombre: "Centro", telefono: "1155551234", foto: PARTES }],
        zonas: [{ sucursalId: SUC, x: 1250, y: 1000, ancho: 3000, alto: 2025, visible: false }],
        versionEsperada: 3,
      },
    });
    expect(ok({ ...base, imagen: "" })).toMatchObject({ ok: true, valor: { imagen: null } });
    expect(ok({ ...base, imagen: null })).toMatchObject({ ok: true, valor: { imagen: null } });
  });

  it("rechaza (con un mensaje y sin lanzar) todo lo que no está permitido", () => {
    const malos: unknown[] = [
      null,
      "x",
      [],
      { ...base, variante: "C" },
      { ...base, variante: "a" },
      { ...base, variante: undefined },
      { variante: "A" },
      { ...base, logoVisible: "si" },
      { ...base, lineaSuperior: "a".repeat(41) },
      { ...base, lineaSuperior: "<b>" },
      { ...base, titulo: 5 },
      { ...base, titulo: "a".repeat(61) },
      { ...base, colorEncabezado: "#ABCDEF" },
      { ...base, colorPagina: "red" },
      { ...base, colorDetras: "#12345" },
      { ...base, imagen: "https://evil.com/x.jpg" },
      { ...base, imagen: 5 },
      { ...base, tarjetas: "x" },
      { ...base, tarjetas: [null] },
      { ...base, tarjetas: [{ sucursalId: "con espacio", orden: 0, visible: true }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: -1, visible: true }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 1.5, visible: true }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: "1", visible: true }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 0, visible: "si" }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 0, visible: true, telefono: "11 5555" }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 0, visible: true, telefono: "11555a" }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 0, visible: true, nombre: "<script>" }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 0, visible: true, foto: "https://evil.com/x.png" }] },
      { ...base, tarjetas: [{ sucursalId: SUC, orden: 0, visible: true }, { sucursalId: SUC, orden: 1, visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "90", y: "0", ancho: "20", alto: "10", visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "0", y: "95", ancho: "20", alto: "10", visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "0", y: "0", ancho: "0", alto: "10", visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "-1", y: "0", ancho: "10", alto: "10", visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "1.234", y: "0", ancho: "10", alto: "10", visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: 0.1 + 0.2, y: 0, ancho: 10, alto: 10, visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: NaN, y: 0, ancho: 10, alto: 10, visible: true }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "0", y: "0", ancho: "10", alto: "10" }] },
      { ...base, zonas: [{ sucursalId: SUC, x: "0", y: "0", ancho: "10", alto: "10", visible: true }, { sucursalId: SUC, x: "50", y: "50", ancho: "10", alto: "10", visible: true }] },
      { ...base, versionEsperada: 0 },
      { ...base, versionEsperada: 1.5 },
      { ...base, versionEsperada: "2" },
      { ...base, versionEsperada: 2_000_000 },
    ];
    for (const m of malos) {
      const r = ok(m);
      expect(r.ok, JSON.stringify(m)).toBe(false);
      if (!r.ok) expect(r.mensaje.length).toBeGreaterThan(5);
    }
  });

  it("un pedido desmedido se rechaza (tope de 200 tarjetas o zonas de una vez)", () => {
    const tarjetas = Array.from({ length: 201 }, (_, i) => ({ sucursalId: `s${i}`, orden: i, visible: true }));
    expect(ok({ ...base, tarjetas }).ok).toBe(false);
    expect(ok({ ...base, tarjetas: tarjetas.slice(0, 200) }).ok).toBe(true);
  });

  it("lo que el navegador agregue de más (empresa, id, código, versión del portal) se ignora: no entra al pedido", () => {
    const r = ok({ ...base, empresaId: "otra", id: "x", codigo: "y".repeat(22), portalId: "z" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.valor).sort()).toEqual(["datos", "imagen", "tarjetas", "versionEsperada", "zonas"]);
  });
});
