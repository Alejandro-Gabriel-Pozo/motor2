import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recargoEnPesos, resolverEstiloCarta, textoDeLaAclaracion, type ItemCartaPublico, type SeccionCartaPublica } from "../../src/core/carta/public";
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

  it("el nombre (h3, rol Producto) con su precio (rol Precio), la descripción y una línea por aclaración, en orden, con el rótulo en Aclaración 600", () => {
    expect(html).toMatch(/^<li data-forma="simple"/);
    expect(html).toMatch(/<h3 data-rol="producto"[^>]*>Bife a la criolla<\/h3>/);
    expect(html).toMatch(/data-rol="precio"[^>]*>\$20\.000<\/span>/);
    expect(texto(html)).toBe("Bife a la criolla $20.000 Con salsa criolla Guarnicion: ensalada, papas fritas o puré Extras: extra de papas +$2.000, huevo frito +$1.500");
    expect(html.match(/<p data-aclaracion="[^"]*" data-rol="aclaracion" class="carta-rol-aclaracion/g)).toHaveLength(2);
    expect(html).toMatch(/<span data-rol="aclaracion-rotulo" class="carta-rol-aclaracion-rotulo"[^>]*>Guarnicion:<\/span>/);
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
    expect(raro).toContain("&lt;b&gt;G&lt;/b&gt;:");
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
    expect(texto(tanda)).toBe("Chico Mediano Grande Café $4.000 $4.100 $4.300 Preparación del café: solo, lágrima +$200 Cortado ★ −10 % $4.200 – $4.500");
    expect(tanda).toContain('<span class="sr-only">no se ofrece</span>');
    expect(tanda.match(/data-rol="opcion-precio"/g)).toHaveLength(5);
    expect(tanda).not.toMatch(/desde/i);
  });

  it("ningún título dentro de una celda de encabezado (el HTML no lo admite): el nombre no es un h3; la descripción y las aclaraciones, en una fila de todo el ancho", () => {
    expect(tanda).not.toMatch(/<th(?=[\s>])[^>]*>(?:(?!<\/th>)[\s\S])*<h[1-6]/);
    expect(tanda).toMatch(/<td colSpan="4"[^>]*><p data-aclaracion="Preparación del café"/);
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

  it("el nombre arriba como h3 (en la esquina, nunca dentro de un th), los rótulos como encabezados de columna y una fila por opción del otro eje", () => {
    expect(html).toMatch(/^<li data-forma="tabla"/);
    expect(html).toMatch(/<thead><tr><td[^>]*><h3 data-rol="producto"[^>]*>Milanesas<\/h3><\/td>/);
    expect(html).not.toMatch(/<th(?=[\s>])[^>]*>(?:(?!<\/th>)[\s\S])*<h[1-6]/);
    expect(html.match(/<th scope="col"[^>]*>([^<]*)<\/th>/g)?.map((t) => texto(t))).toEqual(["Simple", "Napolitana"]);
    expect(html.match(/<th scope="row" data-rol="opcion"[^>]*>([^<]*)<\/th>/g)?.map((t) => texto(t))).toEqual(["De carne", "De pollo", "De trucha"]);
  });

  it("las filas no se juntan aunque cuesten igual (DEC-10); «–» donde no se ofrece; sin «desde»; debajo, la descripción y las aclaraciones", () => {
    expect(texto(html)).toBe("Milanesas Simple Napolitana De carne $20.000 $25.000 De pollo $20.000 $25.000 De trucha $23.000 – Con papas Guarnición: papas fritas o puré");
    expect(html).not.toMatch(/desde/i);
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
    expect(texto(html)).toBe("Pizza muzzarella $18.000 Pizza napolitana $22.000 Masa: fina o al molde");
    expect(html).toMatch(/<ul aria-label="Pizzas" data-filas-carta/);
    expect(html).not.toMatch(/>Pizzas</);
  });

  it("CON EL NOMBRE ARRIBA: el nombre sin precio, la descripción y los tags, y una fila por opción (rol Opción) con su precio final; las aclaraciones al final", () => {
    const html = filaCon(dibujar([pizzas(true)]), "Pizzas");
    expect(html).toMatch(/^<li data-forma="lista"/);
    expect(html.match(/<h3 data-rol="producto"[^>]*>([^<]*)<\/h3>/g)?.map((h) => texto(h))).toEqual(["Pizzas"]);
    expect(html).not.toMatch(/data-rol="precio"/);
    expect(html.match(/data-rol="opcion" class="carta-rol-opcion[ "]/g)).toHaveLength(2);
    expect(texto(html)).toBe("Pizzas A la piedra veggie Pizza muzzarella $18.000 Pizza napolitana $22.000 Masa: fina o al molde");
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
    expect(html).toContain("Salsa:</span> ketchup, mayonesa o alioli");
  });
});
