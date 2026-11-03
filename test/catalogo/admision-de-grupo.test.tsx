import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA (la interacción va en los e2e `catalogo-producto-opciones.spec.ts`,
// `catalogo-opciones-grupo.spec.ts` y `medicion-tareas-del-producto.spec.ts`).
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

import { AdmisionDeGrupo, type GrupoDeLaAdmision, type OpcionDeLaAdmision } from "../../src/app/(app)/catalogo/productos/[id]/opciones/admision-de-grupo";
import { admisionDelFormulario } from "../../src/app/(app)/catalogo/productos/[id]/opciones/admision-del-formulario";

/**
 * Fase 6, paso 6.15a: `AdmisionDeGrupo` con las primitivas del sistema y la lectura del precio debajo de cada importe. Lo que tiene que seguir igual (los `name` del formulario que lee
 * `admision-del-formulario.ts` y los textos de los selectores de los e2e) y lo nuevo (la lectura contra la referencia).
 */
const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const accion = vi.fn();

type FilaDeOpcion = NonNullable<OpcionDeLaAdmision["fila"]>;
const fila = (version: number, precioAbsoluto: number | null, activo = true): FilaDeOpcion => ({ version, cantidadMaxima: 1, precioAbsoluto, diferencia: null, activo });
const opcion = (opcionId: string, nombre: string, f: FilaDeOpcion | null, parcial: { esNinguna?: boolean } = {}): OpcionDeLaAdmision => ({
  opcionId,
  nombre,
  activaEnEmpresa: true,
  esNinguna: parcial.esNinguna ?? false,
  diferenciaDeLaOpcion: null,
  fila: f,
});

const tamanos: GrupoDeLaAdmision = {
  grupoId: "g-tipos",
  nombre: "Tipos de Pizza",
  tipo: "MEDIDA",
  activoEnEmpresa: true,
  cantidadMinimaDelGrupo: 1,
  cantidadMaximaDelGrupo: 1,
  fila: { version: 3, orden: 10, cantidadMinima: null, cantidadMaxima: null, modoPrecio: "ABSOLUTO", activo: true, seMuestraEnCarta: true },
  enLaCarta: "se-muestra",
  queCambianElPrecio: [],
  opciones: [opcion("o-napo", "Napolitana", fila(1, 25000)), opcion("o-muzza", "Muzzarella", fila(1, 18000)), opcion("o-fuga", "Fugazzeta", null)],
};

const extras: GrupoDeLaAdmision = {
  grupoId: "g-extras",
  nombre: "Extras",
  tipo: "VARIANTE",
  activoEnEmpresa: true,
  cantidadMinimaDelGrupo: 0,
  cantidadMaximaDelGrupo: 3,
  fila: { version: 2, orden: 20, cantidadMinima: null, cantidadMaxima: null, modoPrecio: null, activo: true, seMuestraEnCarta: true },
  enLaCarta: "se-muestra",
  queCambianElPrecio: [],
  opciones: [
    { ...opcion("o-trucha", "Trucha", { version: 1, cantidadMaxima: 2, precioAbsoluto: null, diferencia: { tipo: "MONTO", monto: 3000 }, activo: true }), diferenciaDeLaOpcion: { tipo: "MONTO", monto: 1200 } },
    { ...opcion("o-queso", "Queso", { version: 1, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true }), diferenciaDeLaOpcion: { tipo: "MONTO", monto: 800 } },
    opcion("o-nada", "Nada", null, { esNinguna: true }),
  ],
};

const incluidas: GrupoDeLaAdmision = {
  grupoId: "g-inc",
  nombre: "Sabores",
  tipo: "INCLUIDA",
  activoEnEmpresa: true,
  cantidadMinimaDelGrupo: 1,
  cantidadMaximaDelGrupo: 1,
  fila: { version: 1, orden: 30, cantidadMinima: null, cantidadMaxima: null, modoPrecio: null, activo: true, seMuestraEnCarta: true },
  enLaCarta: "se-muestra",
  queCambianElPrecio: [],
  opciones: [opcion("o-a", "Dulce", fila(1, null))],
};

const NAPOLITANA = { opcion: "Muzzarella", precio: 18000 };
const dibujar = (grupo: GrupoDeLaAdmision, props: { referencia?: typeof NAPOLITANA | null; precioDeLista?: number | null } = {}) =>
  renderToStaticMarkup(<AdmisionDeGrupo grupo={grupo} accion={accion} referencia={props.referencia ?? null} precioDeLista={props.precioDeLista ?? null} />);

describe("AdmisionDeGrupo: lo que el formulario sigue mandando (los name que lee admision-del-formulario.ts) y los textos de los e2e", () => {
  it("un tamaño: orden, modoPrecio (radios, uno marcado), el botón «Guardar «grupo»» y el precio de cada opción con su nombre accesible", () => {
    const html = dibujar(tamanos);
    expect(html).toContain('name="orden"');
    expect(html).toContain('name="modoPrecio"');
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*value="ABSOLUTO"[^>]*checked=""|<input[^>]*checked=""[^>]*value="ABSOLUTO"/);
    expect(html).not.toMatch(/<input[^>]*value="DIFERENCIA"[^>]*checked=""/);
    expect(html).toContain("Precio propio por tamaño");
    expect(html).toContain("Diferencia sobre el precio base");
    expect(html).toContain("Cómo se cobra el tamaño en este producto");
    for (const n of ["Napolitana", "Muzzarella", "Fugazzeta"]) expect(html).toContain(`Precio de ${n} en este producto`);
    expect(html).toContain("Guardar «Tipos de Pizza»");
    // un tamaño no tiene mínimo ni máximo propios
    expect(html).not.toContain('name="cantidadMinima"');
    expect(html).not.toContain('name="cantidadMaxima"');
  });

  it("un grupo que no es un tamaño: mínimo y máximo con el valor del grupo como ayuda, tope de cada opción y el selector «Cómo se cobra X en este producto»", () => {
    const html = dibujar(extras, { precioDeLista: 8000 });
    expect(html).toContain('name="cantidadMinima"');
    expect(html).toContain('name="cantidadMaxima"');
    expect(html).toContain('placeholder="del grupo: 0"');
    expect(html).toContain('placeholder="del grupo: 3"');
    expect(html).toContain("Tope de Trucha");
    expect(html).toContain("Cómo se cobra Trucha en este producto");
    expect(html).toContain("Cómo se cobra Queso en este producto");
    expect(texto(html)).toContain("La de la opción (+ $ 800)");
    expect(html).not.toContain("Cómo se cobra el tamaño en este producto");
  });

  it("ya no hay <input type=\"hidden\"> ni controles a mano: lo que antes viajaba oculto (opciones y activo) se agrega al enviar", () => {
    for (const g of [tamanos, extras, incluidas]) expect(dibujar(g)).not.toContain('type="hidden"');
  });

  it("cada opción es una casilla con su nombre; la «ninguna» no tiene importe («Sin recargo»)", () => {
    const html = dibujar(extras, { precioDeLista: 8000 });
    // Tres opciones y, desde «Mostrar este grupo en la carta» (2026-10-29), la casilla del grupo (una variante se puede ocultar): cuatro.
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(4);
    expect(texto(html)).toContain("Nada (ninguna)");
    expect(texto(html)).toContain("Sin recargo");
  });
});

describe("AdmisionDeGrupo: la lectura del precio debajo de cada importe", () => {
  it("un tamaño con precio propio: «Napolitana = $ 25.000» (precio final) y la región en vivo de cada fila", () => {
    const html = dibujar(tamanos);
    expect(texto(html)).toContain("Napolitana = $ 25.000");
    expect(texto(html)).toContain("Muzzarella = $ 18.000");
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(3);
  });

  it("una opción que el producto no admite no se lee: «Fugazzeta» sin tildar y sin precio no dice «Falta el precio final»", () => {
    expect(texto(dibujar(tamanos))).not.toContain("Fugazzeta =");
    expect(texto(dibujar(tamanos))).not.toContain("Falta el precio final");
  });

  it("un extra con su monto propio se lee contra la opción más barata guardada del grupo que fija el precio", () => {
    expect(texto(dibujar(extras, { referencia: NAPOLITANA }))).toContain("Muzzarella con Trucha = $ 18.000 + $ 3.000 = $ 21.000");
  });

  it("el extra que usa la diferencia de la opción se lee con esa diferencia", () => {
    expect(texto(dibujar(extras, { referencia: NAPOLITANA }))).toContain("Muzzarella con Queso = $ 18.000 + $ 800 = $ 18.800");
  });

  it("sin referencia, en un directo se suma sobre el precio de lista: «Con Trucha = $ 8.000 + $ 3.000 = $ 11.000»", () => {
    expect(texto(dibujar(extras, { precioDeLista: 8000 }))).toContain("Con Trucha = $ 8.000 + $ 3.000 = $ 11.000");
  });

  it("sin referencia ni precio de lista (se vende por opción y todavía no tiene precio final) no se lee lo que suma, y no hay error del compositor", () => {
    const html = dibujar(extras, { referencia: null, precioDeLista: null });
    expect(texto(html)).not.toContain("Trucha =");
    expect(texto(html)).not.toContain("menos de 0,01");
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(2); // la región queda en el árbol (Trucha y Queso)
  });

  it("un grupo de lo incluido no tiene importe ni lectura", () => {
    const html = dibujar(incluidas);
    expect(html).not.toContain('aria-live="polite"');
    expect(texto(html)).not.toContain("Precio en este producto");
  });
});

describe("AdmisionDeGrupo: «Mostrar este grupo en la carta» (2026-10-29, decisión del dueño: plato por plato)", () => {
  const conLaCarta = (g: GrupoDeLaAdmision, seMuestraEnCarta: boolean, estado: Pick<GrupoDeLaAdmision, "enLaCarta" | "queCambianElPrecio">): GrupoDeLaAdmision => ({ ...g, fila: { ...g.fila, seMuestraEnCarta }, ...estado });
  /** La casilla del grupo es la PRIMERA de la tarjeta (va antes de la tabla de opciones). */
  const casilla = (html: string) => html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? null;

  it("una variante y una incluida tienen la casilla, tildada si se muestra; con su ayuda en lenguaje de negocio", () => {
    for (const g of [extras, incluidas]) {
      const html = dibujar(g);
      expect(texto(html)).toContain("Mostrar este grupo en la carta");
      expect(texto(html)).toContain("el mozo lo sigue eligiendo al vender y los reportes lo siguen separando");
      expect(casilla(html)).toContain("checked");
    }
  });

  it("un tamaño no la tiene (cambia el precio) y un adicional tampoco", () => {
    expect(texto(dibujar(tamanos))).not.toContain("Mostrar este grupo en la carta");
    expect(texto(dibujar({ ...extras, tipo: "ADICIONAL" }))).not.toContain("Mostrar este grupo en la carta");
  });

  it("apagado y sin efecto en el precio: la casilla sin tildar y la marca «no se muestra en la carta» en la tarjeta, sin aviso", () => {
    const html = dibujar(conLaCarta(incluidas, false, { enLaCarta: "no-se-muestra", queCambianElPrecio: [] }));
    expect(texto(html)).toContain("Elegí 1 · no se muestra en la carta");
    expect(html).not.toContain("data-grupo-oculto-con-precio");
    expect(casilla(html)).not.toBeNull();
    expect(casilla(html)).not.toContain("checked");
  });

  it("apagado pero con una opción que cambia el precio: aviso amarillo que nombra la opción y dice que la carta lo muestra igual; sin la marca", () => {
    const html = dibujar(conLaCarta(extras, false, { enLaCarta: "no-se-muestra-pero-cambia-el-precio", queCambianElPrecio: ["Trucha"] }));
    expect(html).toContain("data-grupo-oculto-con-precio");
    expect(texto(html)).toContain("«Extras» está marcado para no mostrarse en la carta, pero «Trucha» cambia el precio: la carta lo muestra igual para no anunciar un precio que no es.");
    expect(texto(html)).not.toContain("· no se muestra en la carta");
    const varias = dibujar(conLaCarta(extras, false, { enLaCarta: "no-se-muestra-pero-cambia-el-precio", queCambianElPrecio: ["Trucha", "Queso"] }));
    expect(texto(varias)).toContain("«Trucha», «Queso» cambian el precio");
  });
});

describe("admisionDelFormulario: el campo «seMuestraEnCarta» (2026-10-29)", () => {
  const formulario = (campos: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return fd;
  };

  it("«si» es true, «no» es false y sin el campo (un tamaño o un adicional, que no tienen la casilla) es undefined: el servidor conserva lo guardado", () => {
    expect(admisionDelFormulario(formulario({ seMuestraEnCarta: "si" })).seMuestraEnCarta).toBe(true);
    expect(admisionDelFormulario(formulario({ seMuestraEnCarta: "no" })).seMuestraEnCarta).toBe(false);
    expect(admisionDelFormulario(formulario({})).seMuestraEnCarta).toBeUndefined();
    expect(admisionDelFormulario(formulario({ seMuestraEnCarta: "cualquier cosa" })).seMuestraEnCarta).toBeUndefined();
  });
});
