import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { partirLaAclaracion, recargoEnPesos, resolverEstiloCarta, textoDeLaAclaracion, type ItemCartaPublico, type SeccionCartaPublica } from "../../src/core/carta/public";
import { Seccion } from "../../src/components/carta-publica/seccion";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja», ADR-035), paso 8: lo que DIBUJA la carta pública con la forma de cada producto (`presentacion`, que resuelve el servidor), sin base ni navegador.
 * La forma y sus precios los fija `presentacion-en-carta.test.ts`; acá, el HTML: qué se lee, en qué orden, con qué rol de la escala y con qué estructura (títulos, tablas reales con sus encabezados).
 * Sin `presentacion` (una carta guardada por el código anterior) se dibuja como antes.
 */

const item = (extra: Partial<ItemCartaPublico> & { nombre: string }): ItemCartaPublico => ({ categoria: "Platos", descripcion: null, precio: 0, tags: [], especial: false, imagenUrl: null, ...extra });

const dibujar = (items: ItemCartaPublico[], tandas?: SeccionCartaPublica["tandas"]) =>
  renderToStaticMarkup(
    <Seccion
      seccion={{ nombre: "Platos", titulo: null, descripcion: null, imagenUrl: null, orden: 0, items, promos: [], ...(tandas ? { tandas } : {}) }}
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

/** Los `<li>` de primer nivel de la lista de la sección (un ítem o una tanda cada uno, con lo que tengan adentro). */
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

  it("partirLaAclaracion: una elección es una línea «Elegí: …» y nada con recargo", () => {
    expect(partirLaAclaracion({ tipo: "eleccion", rotulo: "Guarnicion", opciones: ["ensalada", "papas fritas", "puré"] })).toEqual({ libres: "Elegí: ensalada, papas fritas o puré", conRecargo: [] });
    expect(partirLaAclaracion({ tipo: "eleccion", rotulo: "Guarnicion", opciones: [] })).toEqual({ libres: null, conRecargo: [] });
  });

  it("partirLaAclaracion: un grupo que mezcla gratis y con recargo deja lo gratis en una línea «Incluidas: …» y cada recargo en su fila", () => {
    expect(
      partirLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "cortado", recargo: 0 }, { nombre: "lágrima", recargo: 200 }, { nombre: "con leche", recargo: 300 }] }),
    ).toEqual({ libres: "Incluidas: solo, cortado", conRecargo: [{ nombre: "lágrima", recargo: 200 }, { nombre: "con leche", recargo: 300 }] });
  });

  it("partirLaAclaracion: UNA sola gratis va en singular («Incluida: solo»)", () => {
    expect(partirLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "lágrima", recargo: 200 }] })).toEqual({ libres: "Incluida: solo", conRecargo: [{ nombre: "lágrima", recargo: 200 }] });
  });

  it("partirLaAclaracion: si todo tiene recargo no hay línea de lo incluido (libres null) y todas van en filas", () => {
    expect(partirLaAclaracion({ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }] })).toEqual({
      libres: null,
      conRecargo: [{ nombre: "extra de papas", recargo: 2000 }, { nombre: "huevo frito", recargo: 1500 }],
    });
  });

  it("partirLaAclaracion: lo que RESTA («sin azúcar −100») también es una fila con recargo, no una opción incluida", () => {
    expect(partirLaAclaracion({ tipo: "extras", rotulo: "Preparación", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "sin azúcar", recargo: -100 }] })).toEqual({ libres: "Incluida: solo", conRecargo: [{ nombre: "sin azúcar", recargo: -100 }] });
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
    expect(texto(html)).toBe("Bife a la criolla $20.000 Con salsa criolla Guarnicion Elegí: ensalada, papas fritas o puré Extras extra de papas +$2.000 huevo frito +$1.500");
    expect(html.match(/<div data-aclaracion="/g)).toHaveLength(2);
    expect(html).toMatch(/<p data-rol="aclaracion-rotulo" class="carta-rol-aclaracion-rotulo"[^>]*>Guarnicion<\/p>/);
  });

  it("P1: lo que no cuesta, en una línea (rol Elección) y sin filas; cada extra que suma, en su fila con el recargo a la derecha (rol Opción)", () => {
    const guarnicion = html.slice(html.indexOf('<div data-aclaracion="Guarnicion"'), html.indexOf('<div data-aclaracion="Extras"'));
    const extras = html.slice(html.indexOf('<div data-aclaracion="Extras"'));
    expect(guarnicion).toMatch(/<p data-rol="eleccion" class="carta-rol-eleccion[^"]*"[^>]*>Elegí: ensalada, papas fritas o puré<\/p>/);
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

describe("8b: una tanda (el café y el cortado comparten Chico | Mediano | Grande) es UNA tabla real", () => {
  const cafe = item({
    nombre: "Café",
    categoria: "Cafetería",
    precio: 4000,
    presentacion: { forma: "columnas", celdas: [4000, 4100, 4300], aclaraciones: [{ tipo: "extras", rotulo: "Preparación del café", opciones: [{ nombre: "solo", recargo: 0 }, { nombre: "lágrima", recargo: 200 }] }] },
  });
  const cortado = item({ nombre: "Cortado", categoria: "Cafetería", precio: 4200, especial: true, descuentoPorcentaje: 10, presentacion: { forma: "columnas", celdas: [4200, null, 4500], aclaraciones: [] } });
  const medialuna = item({ nombre: "Medialuna", categoria: "Cafetería", precio: 1500 });
  const html = dibujar([cafe, cortado, medialuna], [{ primero: 0, ultimo: 1, rotulos: ["Chico", "Mediano", "Grande"] }]);
  const tanda = filaCon(html, "data-tanda");

  it("una sola tabla para los dos, con los rótulos como encabezados de columna y cada producto como encabezado de fila", () => {
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(tanda).toMatch(/^<li data-tanda/);
    expect(tanda.match(/<th scope="col"[^>]*>([^<]*)<\/th>/g)?.map((t) => texto(t))).toEqual(["Chico", "Mediano", "Grande"]);
    expect(tanda.match(/<th scope="row"/g)).toHaveLength(2);
    expect(tanda).toMatch(/<th scope="row"[^>]*><span data-rol="producto" class="carta-rol-producto[^"]*"[^>]*>Café<\/span><\/th>/);
  });

  it("cada celda con su precio (rol Opción 600) y «–» donde no se ofrece, con «no se ofrece» para el lector de pantalla; sin «desde»", () => {
    expect(texto(tanda)).toBe("Chico Mediano Grande Café $4.000 $4.100 $4.300 Preparación del café Incluida: solo lágrima +$200 Cortado ★ −10 % $4.200 – $4.500");
    expect(tanda).toContain('<span class="sr-only">no se ofrece</span>');
    // 5 celdas de precio con valor + el recargo de «lágrima +$200» en su fila (P1).
    expect(tanda.match(/data-rol="opcion-precio"/g)).toHaveLength(6);
    expect(tanda).not.toMatch(/desde/i);
  });

  it("ningún título dentro de una celda de encabezado (el HTML no lo admite): el nombre no es un h3; la descripción y las aclaraciones, en una fila de todo el ancho", () => {
    expect(tanda).not.toMatch(/<th(?=[\s>])[^>]*>(?:(?!<\/th>)[\s\S])*<h[1-6]/);
    expect(tanda).toMatch(/<td colSpan="4"[^>]*><div data-aclaracion="Preparación del café"/);
  });

  it("lo que no está en la tanda (la medialuna) sigue debajo, como un ítem más", () => {
    expect(filaCon(html, "Medialuna")).toMatch(/<h3 data-rol="producto"[^>]*>Medialuna<\/h3>/);
    expect(html.indexOf("Medialuna")).toBeGreaterThan(html.indexOf("</table>"));
  });
});

describe("8c: tabla de dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo / De trucha)", () => {
  const milanesas = item({
    nombre: "Milanesas",
    precio: 20000,
    descripcion: "Con papas",
    presentacion: {
      forma: "tabla",
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

  it("«BC2»: el nombre es un RÓTULO (h3, rol Rótulo) con su línea fina ANTES de la tabla, que no lleva ningún título; los rótulos de las columnas son encabezados de columna (rol Columna)", () => {
    expect(html).toMatch(/^<li data-forma="tabla"/);
    expect(html).toMatch(/<div class="carta-linea-fina[^"]*"><h3 data-rol="rotulo" class="carta-rol-rotulo[^"]*"[^>]*>Milanesas<\/h3><\/div>/);
    expect(html.indexOf('<h3 data-rol="rotulo"')).toBeGreaterThan(-1);
    expect(html.indexOf('<h3 data-rol="rotulo"')).toBeLessThan(html.indexOf("<table"));
    const tabla = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(tabla).not.toMatch(/<h[1-6][\s>]/);
    expect(html).not.toMatch(/<th(?=[\s>])[^>]*>(?:(?!<\/th>)[\s\S])*<h[1-6]/);
    expect(tabla).toMatch(/<thead><tr><td><\/td><th scope="col" data-rol="columna" class="carta-rol-columna/);
    expect(tabla.match(/<th scope="col"[^>]*>([^<]*)<\/th>/g)?.map((t) => texto(t))).toEqual(["Simple", "Napolitana"]);
  });

  it("las opciones protagonizan: cada fila (encabezado de fila) es un plato en rol Producto y cada celda un precio en rol Precio (nunca Opción), con una línea fina entre filas", () => {
    const tabla = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    expect(tabla.match(/<th scope="row"[^>]*><span data-rol="producto" class="carta-rol-producto[^"]*"[^>]*>([^<]*)<\/span><\/th>/g)?.map((t) => texto(t))).toEqual(["De carne", "De pollo", "De trucha"]);
    // 3 filas × 2 columnas: incluida la raya de «De trucha» × Napolitana, que lleva el mismo rol que el precio.
    expect(tabla.match(/data-rol="precio"/g)).toHaveLength(6);
    expect(tabla).not.toContain('data-rol="opcion-precio"');
    expect(tabla).not.toContain('data-rol="opcion"');
    const trs = tabla.slice(tabla.indexOf("<tbody>")).split("<tr");
    expect(trs[1]).not.toContain("border-top-width");
    expect(trs[2]).toContain("border-top-width:1px");
    expect(trs[3]).toContain("border-top-width:1px");
    expect(html).toContain('class="carta-linea-fina');
  });

  it("las filas no se juntan aunque cuesten igual (DEC-10); «–» donde no se ofrece; sin «desde»; debajo, la descripción y las aclaraciones", () => {
    expect(texto(html)).toBe("Milanesas Simple Napolitana De carne $20.000 $25.000 De pollo $20.000 $25.000 De trucha $23.000 – Con papas Guarnición Elegí: papas fritas o puré");
    expect(html).not.toMatch(/desde/i);
    expect(html).toContain('<span class="sr-only">no se ofrece</span>');
  });

  it("con descuento de producto: «−x %» una sola vez, dentro del bloque del rótulo (no en las celdas)", () => {
    const conDescuento = filaCon(dibujar([{ ...milanesas, descuentoPorcentaje: 10 }]), "Milanesas");
    expect(conDescuento.match(/data-descuento-producto/g)).toHaveLength(1);
    const rotulo = conDescuento.slice(0, conDescuento.indexOf("<table"));
    expect(rotulo).toContain("data-descuento-producto");
    expect(rotulo).toContain('<h3 data-rol="rotulo"');
    expect(conDescuento).not.toMatch(/<s[ >]/);
  });
});

describe("8d: lista de un eje (la base de las pizzas: oculta por defecto; con «Mostrar el nombre arriba», con encabezado)", () => {
  const filas = [
    { rotulo: "Pizza muzzarella", precio: 18000 },
    { rotulo: "Pizza napolitana", precio: 22000 },
  ];
  const pizzas = (encabezado: boolean) =>
    item({ nombre: "Pizzas", descripcion: "A la piedra", tags: ["veggie"], precio: 18000, presentacion: { forma: "lista", encabezado, filas, aclaraciones: [{ tipo: "eleccion", rotulo: "Masa", opciones: ["fina", "al molde"] }] } });

  it("OCULTA (DEC-11): cada opción es un plato con su nombre completo (h3, rol Producto) y su precio (rol Precio); el producto base no se nombra", () => {
    const html = filaCon(dibujar([pizzas(false)]), "Pizza muzzarella");
    expect(html).toMatch(/^<li data-forma="lista-sin-encabezado"/);
    expect(html.match(/<h3 data-rol="producto"[^>]*>([^<]*)<\/h3>/g)?.map((h) => texto(h))).toEqual(["Pizza muzzarella", "Pizza napolitana"]);
    expect([...html.matchAll(/data-rol="precio"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["$18.000", "$22.000"]);
    expect(texto(html)).toBe("Pizza muzzarella $18.000 Pizza napolitana $22.000 Masa Elegí: fina o al molde");
    expect(html).toMatch(/<ul aria-label="Pizzas" data-filas-carta/);
    expect(html).not.toMatch(/>Pizzas</);
    expect(html).not.toMatch(/data-rol="rotulo"/);
    expect(html).not.toContain("carta-linea-fina");
  });

  it("CON EL NOMBRE ARRIBA («BC2»): «Pizzas» es un rótulo (h3, rol Rótulo) con su línea fina; cada pizza es un plato (h3, rol Producto) con su precio (rol Precio); las aclaraciones al final", () => {
    const html = filaCon(dibujar([pizzas(true)]), "Pizzas");
    expect(html).toMatch(/^<li data-forma="lista"/);
    expect(html).not.toContain("data-protagonista");
    expect(html.match(/<h3 data-rol="rotulo"[^>]*>([^<]*)<\/h3>/g)?.map((h) => texto(h))).toEqual(["Pizzas"]);
    expect(html).toMatch(/<div class="carta-linea-fina[^"]*"><h3 data-rol="rotulo"/);
    expect(html.match(/<h3 data-rol="producto"[^>]*>([^<]*)<\/h3>/g)?.map((h) => texto(h))).toEqual(["Pizza muzzarella", "Pizza napolitana"]);
    expect([...html.matchAll(/data-rol="precio"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["$18.000", "$22.000"]);
    expect(html).not.toMatch(/data-rol="opcion"/);
    expect(texto(html)).toBe("Pizzas A la piedra veggie Pizza muzzarella $18.000 Pizza napolitana $22.000 Masa Elegí: fina o al molde");
  });

  it("lista con el NOMBRE protagonista (la caída de una tanda de más de 3 tamaños): el nombre (h3, rol Producto) con su línea fina y los tamaños como filas de opción; sin rótulo", () => {
    const cafe = item({
      nombre: "Café",
      precio: 2500,
      presentacion: {
        forma: "lista",
        encabezado: true,
        protagonista: "nombre",
        filas: [{ rotulo: "Mini", precio: 2000 }, { rotulo: "Chico", precio: 2500 }, { rotulo: "Mediano", precio: 2800 }, { rotulo: "Grande", precio: 3100 }],
        aclaraciones: [],
      },
    });
    const html = filaCon(dibujar([cafe]), "Café");
    expect(html).toMatch(/^<li data-forma="lista" data-protagonista="nombre"/);
    expect(html).toMatch(/<div class="carta-linea-fina[^"]*"><h3 data-rol="producto"[^>]*>Café<\/h3>/);
    expect(html).not.toMatch(/data-rol="rotulo"/);
    expect(html.match(/data-rol="opcion" class="carta-rol-opcion[ "]/g)).toHaveLength(4);
    expect(texto(html)).toBe("Café Mini $2.000 Chico $2.500 Mediano $2.800 Grande $3.100");
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

describe("la carta de ejemplo del editor del tema muestra las cuatro formas (paso 12)", () => {
  it("simple, base oculta, tabla de dos ejes y una tanda, en «Entradas»", async () => {
    const { CARTA_EJEMPLO } = await import("../../src/components/carta/carta-ejemplo");
    const entradas = CARTA_EJEMPLO.secciones[0]!;
    const html = renderToStaticMarkup(<Seccion seccion={entradas} indice={0} total={2} estilo={resolverEstiloCarta({})} />);
    for (const forma of ['data-forma="simple"', 'data-forma="lista-sin-encabezado"', 'data-forma="tabla"', "data-tanda"]) expect(html, forma).toContain(forma);
    expect(html).toContain("Salsa</p>");
    expect(html).toContain("Elegí: ketchup, mayonesa o alioli");
  });
});
