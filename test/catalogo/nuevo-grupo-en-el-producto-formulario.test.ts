import { describe, expect, it } from "vitest";
import { guardComandoCrearGrupoEnElProducto, MAX_OPCIONES_EN_UN_ALTA } from "../../src/core/features/catalogo/opciones-de-venta.guard";
import { fraseDeLecturaDePrecio } from "../../src/core/opciones/public";
import {
  FILAS_AL_ABRIR,
  admitePrefijo,
  armarComandoDeGrupoNuevo,
  filaNueva,
  formularioInicial,
  lecturaDeLaFilaNueva,
  llevaImporte,
  textoDeLecturaEnCarta,
  type FormularioDeGrupoNuevo,
} from "../../src/components/catalogo/nuevo-grupo-en-el-producto-formulario";

/**
 * Fase 6, paso 6.15c: lo puro de la ventana «+ Nuevo grupo»: el comando que arma desde el formulario (y que el guard del servidor tiene que aceptar), qué se lee debajo de cada importe y «En la carta se
 * verá: …». Con los casos de la demo (Pizzas: tamaños con precio final; extras que suman; el punto de cocción incluido).
 */
const pesos = (n: number) => `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const form = (parcial: Omit<Partial<FormularioDeGrupoNuevo>, "filas"> & { filas?: [string, string][] }): FormularioDeGrupoNuevo => ({
  nombre: "Tamaño",
  respuesta: "PRECIO_FINAL",
  prefijo: "",
  ...parcial,
  filas: (parcial.filas ?? []).map(([nombre, importe], i) => ({ clave: i, nombre, importe })),
});
const comando = (f: FormularioDeGrupoNuevo) => armarComandoDeGrupoNuevo("prod-1", f);

describe("formularioInicial", () => {
  it("abre sin respuesta elegida, sin nombre y con filas vacías de claves distintas", () => {
    const f = formularioInicial();
    expect(f).toMatchObject({ nombre: "", respuesta: "", prefijo: "" });
    expect(f.filas).toHaveLength(FILAS_AL_ABRIR);
    expect(new Set(f.filas.map((x) => x.clave)).size).toBe(FILAS_AL_ABRIR);
    expect(f.filas.every((x) => x.nombre === "" && x.importe === "")).toBe(true);
    expect(filaNueva(7)).toEqual({ clave: 7, nombre: "", importe: "" });
  });
});

describe("armarComandoDeGrupoNuevo", () => {
  it("precio final: el importe de cada opción como número, el nombre sin espacios y el grupo sin prefijo", () => {
    const c = comando(form({ filas: [["Chico ", "2500"], ["Mediano", "2800,50"], ["Grande", "3100"]] }));
    expect(c).toEqual({
      productoId: "prod-1",
      nombre: "Tamaño",
      respuesta: "PRECIO_FINAL",
      prefijoEnCarta: null,
      opciones: [
        { nombre: "Chico", importe: 2500 },
        { nombre: "Mediano", importe: 2800.5 },
        { nombre: "Grande", importe: 3100 },
      ],
    });
  });

  it("suma: lo tecleado, y una opción sin importe suma 0 (no hace falta teclear un cero)", () => {
    const c = comando(form({ nombre: "Extras", respuesta: "SUMA", filas: [["Trucha", "3000"], ["Sin extra", ""]] }));
    expect(c.opciones).toEqual([
      { nombre: "Trucha", importe: 3000 },
      { nombre: "Sin extra", importe: 0 },
    ]);
  });

  it("incluido: sin importe, aunque algo quedara tecleado de otra respuesta, y sin prefijo", () => {
    const c = comando(form({ nombre: "Punto de cocción", respuesta: "INCLUIDO", prefijo: "De", filas: [["Jugoso", "500"], ["A punto", ""]] }));
    expect(c.opciones).toEqual([
      { nombre: "Jugoso", importe: null },
      { nombre: "A punto", importe: null },
    ]);
    expect(c.prefijoEnCarta).toBeNull();
  });

  it("el prefijo viaja recortado solo si la respuesta lo admite (suma y precio final) y no está vacío", () => {
    expect(comando(form({ prefijo: " De ", filas: [["Carne", "100"]] })).prefijoEnCarta).toBe("De");
    expect(comando(form({ respuesta: "SUMA", prefijo: "Con", filas: [["Queso", ""]] })).prefijoEnCarta).toBe("Con");
    expect(comando(form({ prefijo: "   ", filas: [["Carne", "100"]] })).prefijoEnCarta).toBeNull();
    expect(comando(form({ respuesta: "INCLUIDO", prefijo: "De", filas: [["Carne", ""]] })).prefijoEnCarta).toBeNull();
  });

  it("una fila entera vacía no se manda; una con solo el importe o solo el nombre sí (el servidor dice qué falta)", () => {
    const c = comando(form({ filas: [["Chico", "2500"], ["", ""], ["  ", " "], ["", "2800"], ["Grande", ""]] }));
    expect(c.opciones).toEqual([
      { nombre: "Chico", importe: 2500 },
      { nombre: "", importe: 2800 },
      { nombre: "Grande", importe: null },
    ]);
  });

  it("un importe que no se entendió va como NaN (nunca 0): el servidor lo rechaza", () => {
    const c = comando(form({ filas: [["Chico", "mil"]] }));
    expect(Number.isNaN(c.opciones[0]!.importe)).toBe(true);
  });

  it("sin respuesta elegida va vacía: el servidor dice «Elegí si el grupo cambia el precio.»", () => {
    expect(comando(form({ respuesta: "", filas: [["Chico", "1"]] })).respuesta).toBe("");
  });

  describe("lo que arma lo acepta el guard del servidor (guardComandoCrearGrupoEnElProducto)", () => {
    it("los tres tipos de grupo", () => {
      const casos: FormularioDeGrupoNuevo[] = [
        form({ filas: [["Chico", "2500"], ["Mediano", "2800"], ["Grande", "3100"]] }),
        form({ nombre: "Extras", respuesta: "SUMA", prefijo: "Con", filas: [["Trucha", "3000"], ["Queso", ""], ["", ""]] }),
        form({ nombre: "Punto", respuesta: "INCLUIDO", filas: [["Jugoso", ""], ["A punto", ""]] }),
      ];
      for (const f of casos) {
        const r = guardComandoCrearGrupoEnElProducto(comando(f));
        expect(r.ok, JSON.stringify(r)).toBe(true);
      }
    });

    it("lo que el servidor rechaza sigue rechazándose con su mensaje (la ventana no lo tapa)", () => {
      const sinRespuesta = guardComandoCrearGrupoEnElProducto(comando(form({ respuesta: "", filas: [["Chico", "1"]] })));
      expect(sinRespuesta).toMatchObject({ ok: false, mensaje: "Elegí si el grupo cambia el precio." });
      const sinPrecio = guardComandoCrearGrupoEnElProducto(comando(form({ filas: [["Chico", ""]] })));
      expect(sinPrecio.ok).toBe(false);
      const noEntendido = guardComandoCrearGrupoEnElProducto(comando(form({ filas: [["Chico", "mil"]] })));
      expect(noEntendido.ok).toBe(false);
      const sinOpciones = guardComandoCrearGrupoEnElProducto(comando(form({ filas: [["", ""]] })));
      expect(sinOpciones).toMatchObject({ ok: false, mensaje: "Agregá al menos una opción al grupo." });
    });

    it("el tope de opciones de la ventana es el del servidor: con una más, el guard rechaza", () => {
      const justas = Array.from({ length: MAX_OPCIONES_EN_UN_ALTA }, (_, i) => [`Opción ${i}`, `${i + 1}`] as [string, string]);
      expect(guardComandoCrearGrupoEnElProducto(comando(form({ filas: justas }))).ok).toBe(true);
      expect(guardComandoCrearGrupoEnElProducto(comando(form({ filas: [...justas, ["Una más", "1"]] }))).ok).toBe(false);
    });
  });
});

describe("llevaImporte y admitePrefijo (las tres respuestas)", () => {
  it.each([
    ["", false, false],
    ["INCLUIDO", false, false],
    ["SUMA", true, true],
    ["PRECIO_FINAL", true, true],
  ] as const)("%j: importe %s, prefijo %s", (respuesta, importe, prefijo) => {
    expect(llevaImporte(respuesta)).toBe(importe);
    expect(admitePrefijo(respuesta)).toBe(prefijo);
  });
});

describe("lecturaDeLaFilaNueva", () => {
  const fila = (nombre: string, importe: string) => ({ clave: 1, nombre, importe });
  const frase = (e: Parameters<typeof lecturaDeLaFilaNueva>[0]) => {
    const l = lecturaDeLaFilaNueva(e);
    return l === null ? null : fraseDeLecturaDePrecio(l, pesos);
  };
  const sinBase = { precioDeLista: null, referencia: null };

  it("precio final: «Napolitana = $ 25.000»; sin precio todavía, avisa que falta", () => {
    expect(frase({ respuesta: "PRECIO_FINAL", fila: fila("Napolitana", "25000"), ...sinBase })).toBe("Napolitana = $ 25.000");
    expect(frase({ respuesta: "PRECIO_FINAL", fila: fila("Napolitana", ""), ...sinBase })).toBe("Falta el precio final de «Napolitana»");
  });

  it("lo que suma se lee contra la referencia del producto, o contra su precio de lista", () => {
    expect(frase({ respuesta: "SUMA", fila: fila("Trucha", "3000"), precioDeLista: null, referencia: { opcion: "Napolitana", precio: 25000 } })).toBe("Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000");
    expect(frase({ respuesta: "SUMA", fila: fila("Trucha", "500"), precioDeLista: 8500, referencia: null })).toBe("Con Trucha = $ 8.500 + $ 500 = $ 9.000");
  });

  it("lo que suma no se lee si el producto no da con qué sumar (no se inventa una base)", () => {
    expect(frase({ respuesta: "SUMA", fila: fila("Trucha", "3000"), ...sinBase })).toBeNull();
  });

  it.each([
    ["sin respuesta", { respuesta: "" as const, fila: fila("X", "1") }],
    ["incluido", { respuesta: "INCLUIDO" as const, fila: fila("X", "1") }],
    ["una fila sin nombre", { respuesta: "PRECIO_FINAL" as const, fila: fila("  ", "1") }],
  ])("no se lee: %s", (_que, e) => {
    expect(lecturaDeLaFilaNueva({ ...e, ...sinBase })).toBeNull();
  });
});

describe("textoDeLecturaEnCarta", () => {
  it("sin prefijo, cada opción se lee con su nombre", () => {
    expect(textoDeLecturaEnCarta("", ["Carne"])).toBe("Sin prefijo: cada opción se lee con su nombre.");
    expect(textoDeLecturaEnCarta("   ", ["Carne"])).toBe("Sin prefijo: cada opción se lee con su nombre.");
  });

  it("con prefijo, «De» + «Carne» se lee «De carne» (primera letra en minúscula), de las opciones con nombre", () => {
    expect(textoDeLecturaEnCarta(" De ", ["Carne", "", "Pollo "])).toBe("En la carta se verá: De carne · De pollo");
  });

  it("con prefijo y sin opciones todavía", () => {
    expect(textoDeLecturaEnCarta("De", ["", " "])).toBe("En la carta se verá: De … (todavía no hay opciones)");
  });
});
