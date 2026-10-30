import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { partirLaAclaracion, recargoEnPesos, resolverEstiloCarta, textoDeLaAclaracion, type AclaracionCartaPublica, type ItemCartaPublico } from "../../src/core/carta/public";
import { Seccion } from "../../src/components/carta-publica/seccion";

const CSS_GLOBAL = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");

/**
 * Fase 5 de la ola «precio y carta» («carta pareja», ADR-035), paso 8: lo que DIBUJA la carta pública con la forma de cada producto (`presentacion`, que resuelve el servidor), sin base ni navegador.
 * La forma y sus precios los fija `presentacion-en-carta.test.ts`; acá, el HTML: qué se lee, en qué orden, con qué rol de la escala y con qué estructura (títulos, tablas reales con sus encabezados).
 * Sin `presentacion` (una carta guardada por el código anterior) se dibuja como antes.
 */

const item = (extra: Partial<ItemCartaPublico> & { nombre: string }): ItemCartaPublico => ({ categoria: "Platos", descripcion: null, precio: 0, tags: [], especial: false, imagenUrl: null, ...extra });

const dibujar = (items: ItemCartaPublico[]) =>
  renderToStaticMarkup(
    <Seccion
      seccion={{ nombre: "Platos", titulo: null, descripcion: null, imagenUrl: null, orden: 0, items, promos: [] }}
      indice={0}
      total={1}
      estilo={resolverEstiloCarta({})}
    />,
  );

/** El texto visible de un fragmento de HTML (sin etiquetas, sin lo que es solo para el lector de pantalla). */
const texto = (html: string) =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Los `<li>` de primer nivel de la lista de la sección (un ítem cada uno, con lo que tenga adentro). */
function filasDeLaSeccion(html: string): string[] {
  const lista = html.slice(html.indexOf("<ul data-carta-scroll"));
  const salida: string[] = [];
  let profundidad = 0;
  let inicio = -1;
  for (const m of lista.matchAll(/<li[\s>]|<\/li>/g)) {
    if (m[0].startsWith("<li")) {
      if (profundidad === 0) inicio = m.index;
      profundidad++;
    } else if (--profundidad === 0) salida.push(lista.slice(inicio, m.index + 5));
  }
  return salida;
}

/** El `<li>` de primer nivel de la sección que contiene `marca`. */
const filaCon = (html: string, marca: string) => filasDeLaSeccion(html).find((l) => l.includes(marca)) ?? "";

describe("los textos de la forma (compartidos con la vista previa de la administración)", () => {
  it("una elección se une con «o» (y «u» delante de o/ho); unos extras, con comas y lo que suma cada uno", () => {
    expect(textoDeLaAclaracion({ tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] })).toBe("ensalada, papas fritas o puré");
    expect(textoDeLaAclaracion({ tipo: "eleccion", rotulo: "Cocción", opciones: ["jugoso", "horneado"] })).toBe("jugoso u horneado");
    expect(textoDeLaAclaracion({ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] })).toBe("extra de papas +$2.000, huevo frito +$1.500");
    expect(textoDeLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "con leche", recargo: 300 }, { nombre: "sin azúcar", recargo: -100 }] })).toBe("solo, con leche +$300, sin azúcar −$100");
    expect(recargoEnPesos(-300)).toBe("−$300");
  });

  it("partirLaAclaracion: una elección es una línea con las opciones unidas por « · » (sin prefijo, sin «o») y nada con recargo", () => {
    expect(partirLaAclaracion({ tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] })).toEqual({ libres: "ensalada · papas fritas · puré", conRecargo: [] });
    expect(partirLaAclaracion({ tipo: "eleccion", rotulo: "Guarnicion", opciones: [] })).toEqual({ libres: null, conRecargo: [] });
  });

  it("partirLaAclaracion: un grupo que mezcla gratis y con recargo deja lo gratis en una línea «Sin cargo: …» y cada recargo en su fila", () => {
    expect(
      partirLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "cortado", recargo: 0 }, { nombre: "lágrima", recargo: 200 }, { nombre: "con leche", recargo: 300 }] }),
    ).toEqual({ libres: "Sin cargo: solo · cortado", conRecargo: [{ nombre: "lágrima", recargo: 200 }, { nombre: "con leche", recargo: 300 }] });
  });

  it("partirLaAclaracion: UNA sola gratis también lleva «Sin cargo: » (sin singular/plural)", () => {
    expect(partirLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "lágrima", recargo: 200 }] })).toEqual({ libres: "Sin cargo: solo", conRecargo: [{ nombre: "lágrima", recargo: 200 }] });
  });

  it("partirLaAclaracion: si todo tiene recargo no hay línea de lo incluido (libres null) y todas van en filas", () => {
    expect(partirLaAclaracion({ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] })).toEqual({
      libres: null,
      conRecargo: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }],
    });
  });

  it("partirLaAclaracion: lo que RESTA («sin azúcar −100») también es una fila con recargo, no una opción incluida", () => {
    expect(partirLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "sin azúcar", recargo: -100 }] })).toEqual({ libres: "Sin cargo: solo", conRecargo: [{ nombre: "sin azúcar", recargo: -100 }] });
  });
});

describe("8a: forma simple (el bife: su precio y las aclaraciones debajo)", () => {
  const bife = item({
    nombre: "Bife a la criolla",
    precio: 20000,
    descripcion: "Con salsa criolla",
    presentacion: {
      forma: "simple",
      aclaraciones: [
        { tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] },
        { tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] },
      ],
    },
  });
  const html = filaCon(dibujar([bife]), "Bife a la criolla");

  it("el nombre (h3, rol Producto) con su precio (rol Precio), la descripción y un grupo por aclaración, en orden, con la etiqueta (sin dos puntos) en Aclaración 600", () => {
    expect(html).toMatch(/^<li data-forma="simple"/);
    expect(html).toMatch(/<h3 data-rol="producto"[^>]*>Bife a la criolla<\/h3>/);
    expect(html).toMatch(/data-rol="precio"[^>]*>\$20\.000<\/span>/);
    expect(texto(html)).toBe("Bife a la criolla $20.000 Con salsa criolla Guarnicion ensalada · papas fritas · puré Extras extra de papas +$2.000 huevo frito +$1.500");
    expect(html.match(/<div data-aclaracion="/g)).toHaveLength(2);
    expect(html).toMatch(/<p data-rol="aclaracion-rotulo" class="carta-rol-aclaracion-rotulo"[^>]*>Guarnicion<\/p>/);
  });

  it("P1: lo que no cuesta, en una línea (rol Elección) y sin filas; cada extra que suma, en su fila con el recargo a la derecha (rol Opción)", () => {
    const guarnicion = html.slice(html.indexOf('<div data-aclaracion="Guarnicion"'), html.indexOf('<div data-aclaracion="Extras"'));
    const extras = html.slice(html.indexOf('<div data-aclaracion="Extras"'));
    expect(guarnicion).toMatch(/<p data-rol="eleccion" class="carta-rol-eleccion[^"]*"[^>]*>ensalada · papas fritas · puré<\/p>/);
    expect(guarnicion).not.toContain("data-recargos-carta");
    expect(extras).not.toContain('data-rol="eleccion"');
    expect(extras).toMatch(/<ul aria-label="Extras" data-recargos-carta/);
    expect(extras.match(/<li[\s>]/g)).toHaveLength(2);
    expect(extras.match(/data-rol="opcion" class="carta-rol-opcion[ "]/g)).toHaveLength(2);
    expect([...extras.matchAll(/data-rol="opcion-precio"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["+$2.000", "+$1.500"]);
  });

  it("sin las listas de antes (ni tamaños, ni pastillas, ni «Adicionales:»), aunque el ítem traiga también `grupos` y `opcionesSinCosto`", () => {
    const conLoViejo = filaCon(
      dibujar([{ ...bife, grupos: [{ nombre: "Extras", opciones: [{ nombre: "Huevo frito", tipo: "recargo", recargo: 1500 }] }], opcionesSinCosto: [{ grupo: "Guarnicion", opciones: ["Ensalada", "Puré"] }] }]),
      "Bife a la criolla",
    );
    expect(conLoViejo).not.toMatch(/data-tamanos-carta|data-opciones-sin-costo|data-suma-carta|Adicionales:/);
  });


  it("los nombres del negocio se escapan (no son HTML crudo)", () => {
    const raro = filaCon(dibujar([item({ nombre: "Plato", precio: 1, presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "<b>G</b>", opciones: ['<img src=x onerror="alert(1)">', "b"] }] } })]), "Plato");
    expect(raro).not.toContain("<img src=x");
    expect(raro).toContain("&lt;b&gt;G&lt;/b&gt;</p>");
  });
});

/** Lo que se lee de una tabla de la carta para compararla con otra: las clases de cada columna de precio, los roles de título, encabezado, fila y celda, y la alineación. */
function estructuraDeLaTabla(html: string) {
  const tabla = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
  return {
    columnas: tabla.match(/<col class="[^"]*"/g) ?? [],
    titulo: html.match(/<h3 data-rol="([^"]*)" class="([^"]*)"/)?.slice(1),
    encabezados: [...new Set(tabla.match(/<th scope="col" data-rol="[^"]*" class="[^"]*"/g) ?? [])].map((t) => t.replace(/<th scope="col" /, "")),
    filas: [...new Set(tabla.match(/<span data-rol="opcion" class="[^"]*"/g) ?? [])],
    celdas: [...new Set(tabla.match(/<td class="[^"]*"/g) ?? [])],
    precios: [...new Set(tabla.match(/data-rol="opcion-precio" class="[^"]*"/g) ?? [])],
  };
}

describe("8b: tabla de un eje (el café con variantes, el submarino sin ellas, el té): UNA sola jerarquía y el mismo ancho de columna", () => {
  const T3 = ["Chico", "Mediano", "Grande"];
  const tabla = (nombre: string, columnas: string[], filas: { rotulo: string | null; celdas: (number | null)[] }[], extra: Partial<ItemCartaPublico> = {}) =>
    item({ nombre, categoria: "Bebidas calientes", precio: 3000, presentacion: { forma: "tabla", titulo: true, columnas, filas, aclaraciones: [] }, ...extra });
  const cafe = tabla("Café", T3, ["Solo", "Cortado", "Lágrima"].map((rotulo) => ({ rotulo, celdas: [4000, 4100, 4300] })));
  const submarino = tabla("Submarino", T3, [{ rotulo: null, celdas: [5000, 5500, 6000] }]);
  const te = tabla("Té", ["Taza", "Jarra"], [{ rotulo: "Negro", celdas: [2800, 4200] }]);

  it("Café con variantes y Submarino sin variantes: mismas clases de columna y mismos roles (título en rol Producto, encabezado en rol Columna, fila en rol Opción, celda en rol Opción precio)", () => {
    const delCafe = estructuraDeLaTabla(filaCon(dibujar([cafe]), "Café"));
    const delSubmarino = estructuraDeLaTabla(filaCon(dibujar([submarino]), "Submarino"));
    expect(delCafe.titulo?.[0]).toBe("producto");
    expect(delCafe.columnas).toEqual(['<col class="carta-col-precio"', '<col class="carta-col-precio"', '<col class="carta-col-precio"']);
    expect(delSubmarino.columnas).toEqual(['<col class="carta-col-precio"', '<col class="carta-col-precio"', '<col class="carta-col-precio"']);
    const { filas: filasDelCafe, ...restoDelCafe } = delCafe;
    const { filas: filasDelSubmarino, ...restoDelSubmarino } = delSubmarino;
    expect(restoDelSubmarino).toEqual(restoDelCafe);
    expect(delCafe.encabezados).toEqual(['data-rol="columna" class="carta-rol-columna pb-1 pl-3 pt-1 text-right align-bottom"']);
    expect(delCafe.celdas).toEqual(['<td class="whitespace-nowrap py-1.5 pl-3 text-right align-baseline"']);
    expect(delCafe.precios).toEqual(['data-rol="opcion-precio" class="carta-rol-opcion-precio carta-titulo"']);
    expect(filasDelCafe, "las variantes del café: filas en rol Opción").toEqual(['<span data-rol="opcion" class="carta-rol-opcion"']);
    expect(filasDelSubmarino, "el submarino no tiene variantes: una sola fila sin rótulo").toEqual([]);
  });

  it("el Té con tamaños propios (Taza | Jarra) usa la misma clase de ancho en sus columnas, y cada producto repite sus encabezados (sin «–» ni tanda compartida)", () => {
    const html = dibujar([submarino, cafe, te]);
    expect(html.match(/<col class="carta-col-precio"/g)).toHaveLength(3 + 3 + 2);
    expect(html.match(/<table/g)).toHaveLength(3);
    expect(html).not.toContain("data-tanda");
    expect(filaCon(html, "Té").match(/<th scope="col"[^>]*>([^<]*)<\/th>/g)?.map((h) => texto(h))).toEqual(["Taza", "Jarra"]);
    expect(texto(filaCon(html, "Submarino"))).toBe("Submarino Chico Mediano Grande $5.000 $5.500 $6.000");
  });

  it("el título protagoniza: un h3 (rol Producto) con su línea fina ANTES de la tabla; el descuento a la derecha del nombre, una sola vez; la ★ en el especial", () => {
    const html = filaCon(dibujar([{ ...cafe, especial: true, descuentoPorcentaje: 10 }]), "Café");
    expect(html).toMatch(/^<li data-forma="tabla" class="carta-tabla/);
    expect(html).toMatch(/<div class="carta-linea-fina[^"]*"><h3 data-rol="producto" class="carta-rol-producto[^"]*"[^>]*>Café[\s\S]*?<\/h3>[\s\S]*?−10 %[\s\S]*?<\/div><table/);
    expect(html).toContain("Especial");
    expect(html.match(/data-descuento-producto/g)).toHaveLength(1);
    expect(html).not.toContain('data-rol="rotulo"');
    // Ningún título dentro de una celda de encabezado (el HTML no lo admite).
    expect(html).not.toMatch(/<th(?=[\s>])[^>]*>(?:(?!<\/th>)[\s\S])*<h[1-6]/);
  });

  it("una tabla sin encabezados (los tamaños van en las filas) es una sola columna de precios, sin `thead`", () => {
    const filas = dibujar([tabla("Pizzas", [], [{ rotulo: "Chica", celdas: [18000] }, { rotulo: "Grande", celdas: [24000] }])]);
    expect(filas.match(/<col class="carta-col-precio"/g)).toHaveLength(1);
    expect(filas).not.toContain("<thead");
    expect(texto(filaCon(filas, "Pizzas"))).toBe("Pizzas Chica $18.000 Grande $24.000");
  });
});

describe("8c: tabla de dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo / De trucha)", () => {
  const milanesas = item({
    nombre: "Milanesas",
    precio: 20000,
    descripcion: "Con papas",
    presentacion: {
      forma: "tabla",
      titulo: true,
      columnas: ["Simple", "Napolitana"],
      filas: [
        { rotulo: "De carne", celdas: [20000, 25000] },
        { rotulo: "De pollo", celdas: [20000, 25000] },
        { rotulo: "De trucha", celdas: [23000, null] },
      ],
      aclaraciones: [{ tipo: "eleccion", rotulo: "Guarnición", opciones: ["papas fritas", "puré"] }],
    },
  });
  const html = filaCon(dibujar([milanesas]), "Milanesas");

  it("jerarquía única: el nombre es el TÍTULO (h3, rol Producto) con su línea fina ANTES de la tabla, que no lleva ningún título; los rótulos de las columnas son encabezados de columna (rol Columna)", () => {
    expect(html).toMatch(/^<li data-forma="tabla"/);
    expect(html).toMatch(/<div class="carta-linea-fina[^"]*"><h3 data-rol="producto" class="carta-rol-producto[^"]*"[^>]*>Milanesas<\/h3><\/div>/);
    expect(html.indexOf('<h3 data-rol="producto"')).toBeLessThan(html.indexOf("<table"));
    const tabla = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(tabla).not.toMatch(/<h[1-6][\s>]/);
    expect(html).not.toMatch(/<th(?=[\s>])[^>]*>(?:(?!<\/th>)[\s\S])*<h[1-6]/);
    expect(tabla).toMatch(/<thead><tr><td><\/td><th scope="col" data-rol="columna" class="carta-rol-columna/);
    expect(tabla.match(/<th scope="col"[^>]*>([^<]*)<\/th>/g)?.map((t) => texto(t))).toEqual(["Simple", "Napolitana"]);
  });

  it("las filas son opciones: cada encabezado de fila en rol Opción y cada celda un precio en rol Opción precio (nunca Producto ni Precio), con una línea fina entre filas", () => {
    const tabla = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(tabla.match(/<th scope="row"[^>]*><span data-rol="opcion" class="carta-rol-opcion[^"]*"[^>]*>([^<]*)<\/span><\/th>/g)?.map((t) => texto(t))).toEqual(["De carne", "De pollo", "De trucha"]);
    // 3 filas × 2 columnas: incluida la raya de «De trucha» × Napolitana, que lleva el mismo rol que el precio.
    expect(tabla.match(/data-rol="opcion-precio"/g)).toHaveLength(6);
    expect(tabla).not.toContain('data-rol="precio"');
    expect(tabla).not.toContain('data-rol="producto"');
    const trs = tabla.slice(tabla.indexOf("<tbody>")).split("<tr");
    expect(trs[1]).not.toContain("border-t");
    expect(trs[2]).toContain('class="carta-borde border-t"');
    expect(trs[3]).toContain('class="carta-borde border-t"');
    expect(html).toContain('class="carta-linea-fina');
  });

  it("las filas no se juntan aunque cuesten igual (DEC-10); «–» donde no se ofrece; sin «desde»; debajo, la descripción y las aclaraciones", () => {
    expect(texto(html)).toBe("Milanesas Simple Napolitana De carne $20.000 $25.000 De pollo $20.000 $25.000 De trucha $23.000 – Con papas Guarnición papas fritas · puré");
    expect(html).not.toMatch(/desde/i);
    expect(html).toContain('<span class="sr-only">no se ofrece</span>');
  });

  it("con descuento de producto: «−x %» una sola vez, dentro del bloque del título (no en las celdas)", () => {
    const conDescuento = filaCon(dibujar([{ ...milanesas, descuentoPorcentaje: 10 }]), "Milanesas");
    expect(conDescuento.match(/data-descuento-producto/g)).toHaveLength(1);
    const titulo = conDescuento.slice(0, conDescuento.indexOf("<table"));
    expect(titulo).toContain("data-descuento-producto");
    expect(titulo).toContain('<h3 data-rol="producto"');
    expect(conDescuento).not.toMatch(/<s[ >]/);
  });
});

describe("8d: la base de un eje (las pizzas): oculta por defecto, cada opción como un plato; con «Mostrar el nombre arriba», una tabla con título", () => {
  const filas = [
    { rotulo: "Pizza muzzarella", celdas: [18000] },
    { rotulo: "Pizza napolitana", celdas: [22000] },
  ];
  const pizzas = (titulo: boolean) =>
    item({ nombre: "Pizzas", descripcion: "A la piedra", tags: ["veggie"], precio: 18000, presentacion: { forma: "tabla", titulo, columnas: [], filas, aclaraciones: [{ tipo: "eleccion", rotulo: "Masa", opciones: ["fina", "al molde"] }] } });

  it("OCULTA (DEC-11): cada opción es un plato con su nombre completo (h3, rol Producto) y su precio (rol Precio); el producto base no se nombra", () => {
    const html = filaCon(dibujar([pizzas(false)]), "Pizza muzzarella");
    expect(html).toMatch(/^<li data-forma="lista-sin-encabezado"/);
    expect(html.match(/<h3 data-rol="producto"[^>]*>([^<]*)<\/h3>/g)?.map((h) => texto(h))).toEqual(["Pizza muzzarella", "Pizza napolitana"]);
    expect([...html.matchAll(/data-rol="precio"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["$18.000", "$22.000"]);
    expect(texto(html)).toBe("Pizza muzzarella $18.000 Pizza napolitana $22.000 Masa fina · al molde");
    expect(html).toMatch(/<ul aria-label="Pizzas" data-filas-carta/);
    expect(html).not.toMatch(/>Pizzas</);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("carta-linea-fina");
  });

  it("CON EL NOMBRE ARRIBA: «Pizzas» es el título (h3, rol Producto) con su línea fina; cada pizza es una fila (rol Opción) con su precio (rol Opción precio) en una sola columna sin encabezado; las aclaraciones al final", () => {
    const html = filaCon(dibujar([pizzas(true)]), "Pizzas");
    expect(html).toMatch(/^<li data-forma="tabla"/);
    expect(html).toMatch(/<div class="carta-linea-fina[^"]*"><h3 data-rol="producto"[^>]*>Pizzas<\/h3>/);
    expect(html.match(/<span data-rol="opcion" class="carta-rol-opcion[^"]*"[^>]*>([^<]*)<\/span>/g)?.map((h) => texto(h))).toEqual(["Pizza muzzarella", "Pizza napolitana"]);
    expect([...html.matchAll(/data-rol="opcion-precio"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["$18.000", "$22.000"]);
    expect(html).not.toContain("<thead");
    expect(texto(html)).toBe("Pizzas Pizza muzzarella $18.000 Pizza napolitana $22.000 A la piedra veggie Masa fina · al molde");
  });

  it("con descuento de producto: «−x %» una vez, sin tachar fila por fila", () => {
    const html = filaCon(dibujar([{ ...pizzas(false), descuentoPorcentaje: 10 }]), "Pizza muzzarella");
    expect(html.match(/data-descuento-producto/g)).toHaveLength(1);
    expect(html).not.toMatch(/<s[ >]/);
  });
});

describe("paso 9: sin forma (lo que la carta no puede leer exacto, o una carta guardada por el código anterior) se dibuja con las MISMAS piezas, sin las listas viejas", () => {
  const cafe = item({
    nombre: "Café",
    categoria: "Cafetería",
    precio: 2500,
    grupos: [
      { nombre: "Tamaño", opciones: [{ nombre: "Chico", tipo: "final", precio: 2500 }, { nombre: "Grande", tipo: "final", precio: 3100 }] },
      { nombre: "Extras", opciones: [{ nombre: "Medialuna", tipo: "recargo", recargo: 600 }, { nombre: "Sin azúcar", tipo: "recargo", recargo: -100 }] },
    ],
    opcionesSinCosto: [{ grupo: "Preparación", opciones: ["Solo", "Cortado"] }],
  });
  const html = filaCon(dibujar([cafe]), "Café");

  it("los tamaños como filas de opción (sin el precio al lado del nombre), lo que no cambia nada y lo que suma como aclaraciones debajo", () => {
    expect(texto(html)).toBe("Café Chico $2.500 Grande $3.100 Preparación: Solo o Cortado Adicionales: Medialuna +$600, Sin azúcar −$100");
    expect(html).toMatch(/<ul aria-label="Tamaño" data-filas-carta/);
    expect(html).not.toMatch(/data-rol="precio"/);
  });

  it("ninguna de las piezas retiradas (lista de tamaños, pastillas, línea «Adicionales» propia)", () => {
    expect(html).not.toMatch(/data-tamanos-carta|data-opciones-sin-costo|data-suma-carta|rounded-full/);
  });

  it("lo que no se puede leer exacto sale como antes: la línea única por grupo (`ItemComoAntes` no arma la jerarquía de grupos y filas)", () => {
    expect(html).toMatch(/<p data-aclaracion="Preparación"/);
    expect(html).not.toMatch(/<div data-aclaracion=|data-recargos-carta|data-rol="eleccion"/);
  });

  it("un ítem sin opciones, el renglón de siempre", () => {
    const flan = filaCon(dibujar([item({ nombre: "Flan", precio: 3200 })]), "Flan");
    expect(texto(flan)).toBe("Flan $3.200");
  });
});

describe("la carta de ejemplo del editor del tema muestra las formas (paso 12)", () => {
  it("simple, base oculta, tabla de dos ejes y tablas de un eje, en «Entradas»", async () => {
    const { CARTA_EJEMPLO } = await import("../../src/components/carta/carta-ejemplo");
    const entradas = CARTA_EJEMPLO.secciones[0]!;
    const html = renderToStaticMarkup(<Seccion seccion={entradas} indice={0} total={2} estilo={resolverEstiloCarta({})} />);
    for (const forma of ['data-forma="simple"', 'data-forma="lista-sin-encabezado"', 'data-forma="tabla"']) expect(html, forma).toContain(forma);
    expect(html).not.toContain("data-tanda");
    expect(html).toContain("Salsa</p>");
    expect(html).toContain("ketchup · mayonesa · alioli");
  });
});

describe("C9: la carta con P1 no usa verbos en las aclaraciones", () => {
  it("ningún texto de la carta con P1 (bife, café, café con una sola gratis, carta de ejemplo) contiene «Elegí» ni «Incluida»", async () => {
    const { CARTA_EJEMPLO } = await import("../../src/components/carta/carta-ejemplo");
    const textos = [
      texto(dibujar([item({ nombre: "Bife", precio: 20000, presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] }] } })])),
      texto(dibujar([item({ nombre: "Café", precio: 4000, presentacion: { forma: "simple", aclaraciones: [{ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "cortado", recargo: 0 }, { nombre: "lágrima", recargo: 200 }] }] } })])),
      texto(dibujar([item({ nombre: "Café", precio: 4000, presentacion: { forma: "simple", aclaraciones: [{ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "lágrima", recargo: 200 }] }] } })])),
      renderToStaticMarkup(<Seccion seccion={CARTA_EJEMPLO.secciones[0]!} indice={0} total={2} estilo={resolverEstiloCarta({})} />),
    ];
    for (const t of textos) expect(t).not.toMatch(/Elegí|Incluida/);
    expect(textos[0]).toContain("ensalada · papas fritas · puré");
    expect(textos[1]).toContain("Sin cargo: solo · cortado");
    expect(textos[2]).toContain("Sin cargo: solo");
  });
});

describe("C12: la línea que separa un producto del siguiente es la misma clara en toda forma", () => {
  // `divide-y` pinta el borde de abajo de cada `<li>` con el color DEL `<li>` (no del `ul`): un `<li>` sin color cae al color del texto y se ve negro. La forma de un producto no puede cambiar el separador.
  // C13: el color se declara UNA vez, en `globals.css` (`.carta-shell .carta-divisor > *`), y la lista de productos de la sección lleva `carta-divisor`: ningún `<li>` lo escribe por su cuenta.
  const aclaracion: AclaracionCartaPublica = { tipo: "eleccion", rotulo: "Guarnición", opciones: ["papas fritas", "puré"] };
  const filas = [{ rotulo: "Pizza muzzarella", celdas: [18000] }, { rotulo: "Pizza napolitana", celdas: [22000] }];
  const siguiente = item({ nombre: "Flan", precio: 3200 });
  const formas: { forma: string; productos: ItemCartaPublico[] }[] = [
    { forma: "simple", productos: [item({ nombre: "Bife", precio: 20000, presentacion: { forma: "simple", aclaraciones: [aclaracion] } })] },
    {
      forma: "tabla de dos ejes",
      productos: [item({ nombre: "Milanesas", precio: 20000, presentacion: { forma: "tabla", titulo: true, columnas: ["Simple", "Napolitana"], filas: [{ rotulo: "De carne", celdas: [20000, 25000] }, { rotulo: "De pollo", celdas: [20000, 25000] }], aclaraciones: [] } })],
    },
    { forma: "tabla de un eje con el nombre arriba", productos: [item({ nombre: "Pizzas", precio: 18000, presentacion: { forma: "tabla", titulo: true, columnas: [], filas, aclaraciones: [] } })] },
    { forma: "tabla de tamaños (café)", productos: [item({ nombre: "Licuado", precio: 2000, presentacion: { forma: "tabla", titulo: true, columnas: ["Chico", "Grande"], filas: [{ rotulo: null, celdas: [2000, 2500] }], aclaraciones: [] } })] },
    { forma: "base oculta (sin título)", productos: [item({ nombre: "Empanadas", precio: 18000, presentacion: { forma: "tabla", titulo: false, columnas: [], filas, aclaraciones: [] } })] },
    { forma: "sin opciones", productos: [item({ nombre: "Tostado", precio: 5000 })] },
    {
      forma: "sin forma (ItemComoAntes)",
      productos: [item({ nombre: "Té", precio: 2500, grupos: [{ nombre: "Tamaño", opciones: [{ nombre: "Chico", tipo: "final", precio: 2500 }, { nombre: "Grande", tipo: "final", precio: 3100 }] }] })],
    },
  ];

  it("globals.css declara el color del separador UNA vez: `.carta-shell .carta-divisor > *` con `border-color: var(--carta-border)` (y `.carta-borde` para el borde propio)", () => {
    const regla = (selector: string) => CSS_GLOBAL.match(new RegExp(`${selector.replace(/[.*>]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(regla(".carta-shell .carta-divisor > *")).toMatch(/(?:^|[\s;])border-color:\s*var\(--carta-border\)\s*;/);
    expect(regla(".carta-shell .carta-borde")).toMatch(/(?:^|[\s;])border-color:\s*var\(--carta-border\)\s*;/);
  });

  it.each(formas)("$forma: la lista de productos de la sección lleva `carta-divisor` y ningún `<li>` escribe el color por su cuenta", ({ productos }) => {
    const html = dibujar([...productos, siguiente]);
    const abre = html.slice(html.indexOf("<ul data-carta-scroll"), html.indexOf(">", html.indexOf("<ul data-carta-scroll")));
    const clases = (/class="([^"]*)"/.exec(abre)?.[1] ?? "").split(/\s+/);
    expect(clases).toEqual(expect.arrayContaining(["divide-y", "carta-divisor"]));
    const filasLi = filasDeLaSeccion(html);
    expect(filasLi.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/border-color:\s*var\(--carta-border\)/);
  });
});
