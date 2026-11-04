import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VistaPreviaDeLaCarta } from "../../src/components/catalogo/espacio-del-producto/vista-previa-de-la-carta";
import { CartaVista } from "../../src/components/carta-publica/carta-vista";
import { Seccion } from "../../src/components/carta-publica/seccion";
import { presentacionDeUnProductoSolo, resolverEstiloCarta, type CartaPublicaV1, type ItemCartaPublico, type PresentacionCartaV1, type SeccionCartaPublica } from "../../src/core/carta/public";
import { vistaPreviaDeLaForma } from "../../src/core/carta/mantenimiento";
import type { DiferenciaDePrecio } from "../../src/core/opciones/public";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { cartaDeUnProducto } from "../../src/core/pos/precio-de-configuracion";
import { CANAL, CANTIDAD, DESCRIPCION, INCLUYE, LIMITES, OPCION, REGLAS, REGLAS_DEL_DETALLE, TAMANO_DEL_PRODUCTO, VISIBLE, CUE_DE_LA_INVITACION, reglaDelDetalle, reglasQueAplican, todasLasCombinaciones, vaConEsperado, type Combinacion, type Esperado } from "./incluye-en-carta.oraculo";

/**
 * Carta «B» (2026-11-04): las COMBINACIONES de lo que dice la carta de lo que se elige sin costo, recorridas ENTERAS contra el oráculo escrito a mano en `incluye-en-carta.oraculo.ts` (que no importa nada
 * de `src/`). Cada combinación arma los grupos de dos platos como la base (`GrupoParaVender`), los pasa por la MISMA cadena que la carta (`cartaDeUnProducto` → `tablaDePreciosParaLaCarta` →
 * `presentacionDeUnProductoSolo`, donde se aplican «Mostrar este grupo en la carta», las opciones apagadas y el subconjunto que admite cada plato) y lee el resultado en el canal: la carta pública y la
 * impresa (la sección con los dos platos) o la vista previa del producto y «Va a mostrar» (solo el plato bajo prueba). Un fallo imprime la combinación entera, la regla y lo esperado frente a lo obtenido.
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });

function opcion(opcionId: string, nombre: string, orden: number, extra: Partial<OpcionParaVender>): OpcionParaVender {
  return {
    opcionId,
    nombre,
    orden,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 1,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: monto(0),
    factorEscala: null,
    consumos: [],
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}

const NOMBRES = ["Puré", "Ensalada", "Papas fritas"] as const;

/** Los grupos de UN plato: «Guarnición» (INCLUIDA, sin precio) con las opciones del grupo, las que el plato admite y las que se apagaron en la sucursal. */
function gruposDelPlato(c: Combinacion, plato: "bife" | "milanesa"): (GrupoParaVender & { seMuestraEnCarta: boolean })[] {
  if (plato === "bife" && c.incluye === "no") return [];
  const definidas = c.cantidad === 1 ? 1 : 3;
  const opciones = NOMBRES.slice(0, definidas).map((nombre, i) => {
    const esLaUltima = i === definidas - 1;
    // El subconjunto de Bife son todas las definidas menos la última; con una sola definida, la única.
    const admitida = plato === "bife" && c.incluye === "subconjunto" && definidas > 1 ? !esLaUltima : true;
    // La apagada es la última definida; con una sola definida no se apaga (dejaría el grupo obligatorio sin opciones y el plato no se podría pedir: ese caso lo cubre la regla de la venta).
    const apagada = c.opcion === "ultima-apagada" && esLaUltima && definidas > 1;
    // E3: la descripción es de «Papas fritas» (la última definida).
    const descripcionEnCarta = c.descripcion === "texto" && nombre === "Papas fritas" ? "papas rústicas con cáscara" : null;
    return opcion(`o${i}`, nombre, i, { admitida, apagadaEnSucursal: apagada, descripcionEnCarta });
  });
  const propios = plato === "bife" && c.limites === "distintos";
  return [
    {
      grupoId: "g-guarnicion",
      nombre: "Guarnición",
      tipo: "INCLUIDA",
      activo: true,
      admitido: true,
      cantidadMinima: 1,
      cantidadMaxima: propios ? 2 : 1,
      orden: 0,
      modoPrecio: null,
      opciones,
      seMuestraEnCarta: c.visible === "visible",
    },
  ];
}

/** La forma que la carta le da a un plato con esos grupos (la cadena real), o `null` si no tiene opciones. */
function formaDelPlato(grupos: readonly (GrupoParaVender & { seMuestraEnCarta: boolean })[]): PresentacionCartaV1 | null {
  if (grupos.length === 0) return null;
  const { tabla } = cartaDeUnProducto({ grupos, precioBase: 10000, descuentoDeProducto: null, esBase: false });
  return tabla ? presentacionDeUnProductoSolo({ tabla, esBase: false, mostrarNombreArriba: false, conDescuento: false }) : null;
}

const itemDe = (nombre: string, forma: PresentacionCartaV1 | null): ItemCartaPublico => ({ nombre, categoria: "Platos principales", descripcion: null, precio: 10000, tags: [], especial: false, imagenUrl: null, ...(forma ? { presentacion: forma } : {}) });

const seccionDe = (items: ItemCartaPublico[]): SeccionCartaPublica => ({ nombre: "Platos principales", titulo: null, descripcion: null, imagenUrl: null, orden: 0, items, promos: [] });

const ESTILO = resolverEstiloCarta({});

// ---- Lo que se lee en cada canal, normalizado a la forma del oráculo -------------------------------------------------------------------------------------------------------------------

/** Saca las etiquetas hasta que no quede ninguna (una sola pasada puede dejar `<script` armado con lo que queda; alerta de CodeQL «incomplete multi-character sanitization»). */
function sinEtiquetas(html: string): string {
  let texto = html;
  for (let previo = ""; previo !== texto; ) {
    previo = texto;
    texto = texto.replace(/<[^>]+>/g, "");
  }
  return texto.replace(/&amp;/g, "&").trim();
}

/** La línea «Incluye …» del plato `nombre` en un HTML de carta (null si no tiene). */
function lineaEnHtml(html: string, nombre: string): string | null {
  const fila = html.split(/<li[\s>]/).find((l) => l.includes(`>${nombre}<`) && !l.includes("data-bloque-de-opciones"));
  const m = fila?.match(/<p data-incluye[^>]*>(.*?)<\/p>/);
  return m ? sinEtiquetas(m[1]!) : null;
}

/** El bloque al pie en un HTML de carta (null si no hay). Si hubiera más de uno es un error del oráculo: el escenario tiene UN grupo. */
function bloqueEnHtml(html: string): Esperado["bloque"] {
  const bloques = html.split(/<li[\s>]/).filter((l) => l.includes("data-bloque-de-opciones"));
  expect(bloques.length, "el escenario tiene un solo grupo: a lo sumo un bloque").toBeLessThanOrEqual(1);
  const b = bloques[0];
  if (!b) return null;
  const titulo = b.match(/<h4[^>]*>(.*?)<\/h4>/)?.[1];
  const opciones = b.match(/<p data-rol="eleccion"[^>]*>(.*?)<\/p>/)?.[1];
  const para = b.match(/<p data-rol="aclaracion"[^>]*>(.*?)<\/p>/)?.[1];
  return { titulo: sinEtiquetas(titulo ?? ""), opciones: sinEtiquetas(opciones ?? ""), paraLosPlatos: sinEtiquetas(para ?? "") };
}

/** E3: el detalle del bloque en un HTML de carta: el desplegable de pantalla (con su rótulo) y la lista de papel, normalizados a «nombre · descripción». `null` = no hay. */
function detalleEnHtml(html: string): { pantalla: string | null; rotulo: string | null; papel: string | null } {
  const pantalla = html.match(/<details data-detalle-del-bloque[^>]*>(.*?)<\/details>/)?.[1] ?? null;
  const papel = html.match(/<div data-detalle-en-papel[^>]*>(.*?)<\/div>/)?.[1] ?? null;
  const filas = (x: string) => [...x.matchAll(/<p [^>]*>(.*?)<\/p>/g)].map((m) => sinEtiquetas(m[1]!)).join(" | ");
  return { pantalla: pantalla ? filas(pantalla) : null, rotulo: pantalla ? sinEtiquetas(pantalla.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? "") : null, papel: papel ? filas(papel) : null };
}

/** E2: el «Va con: …» del bloque (null si no hay) y cuántos botones de invitación hay en el HTML. */
function invitacionEnHtml(html: string): { vaCon: string | null; botones: number } {
  const vaCon = html.match(/<p data-va-con[^>]*>(.*?)<\/p>/)?.[1];
  return { vaCon: vaCon ? sinEtiquetas(vaCon) : null, botones: (html.match(/data-ir-al-bloque=/g) ?? []).length };
}

/** Lo que se ve en el canal, con la forma del oráculo; en «Va a mostrar» (un texto) se compara la oración entera aparte. */
function leerElCanal(c: Combinacion): { obtenido: Esperado; oracion?: string; detalle?: ReturnType<typeof detalleEnHtml>; invitacion?: ReturnType<typeof invitacionEnHtml> } {
  const gruposBife = gruposDelPlato(c, "bife");
  const gruposMilanesa = gruposDelPlato(c, "milanesa");
  const formaBife = formaDelPlato(gruposBife);
  const formaMilanesa = formaDelPlato(gruposMilanesa);

  if (c.canal === "publica") {
    const html = renderToStaticMarkup(<Seccion seccion={seccionDe([itemDe("Bife", formaBife), itemDe("Milanesa", formaMilanesa)])} indice={0} total={1} estilo={ESTILO} />);
    return { obtenido: { bife: lineaEnHtml(html, "Bife"), milanesa: lineaEnHtml(html, "Milanesa"), bloque: bloqueEnHtml(html) }, detalle: detalleEnHtml(html), invitacion: invitacionEnHtml(html) };
  }
  if (c.canal === "impresa") {
    const seccion = seccionDe([itemDe("Bife", formaBife), itemDe("Milanesa", formaMilanesa)]);
    const carta: CartaPublicaV1 = { version: 1, generadoEn: "2026-11-04T15:00:00.000Z", sucursal: { nombre: "Centro" }, secciones: [seccion], seccionesImpresas: [seccion] };
    const html = renderToStaticMarkup(<CartaVista carta={carta} estilo={ESTILO} />);
    const impresa = html.slice(html.indexOf("data-carta-impresa"));
    return { obtenido: { bife: lineaEnHtml(impresa, "Bife"), milanesa: lineaEnHtml(impresa, "Milanesa"), bloque: bloqueEnHtml(impresa) }, detalle: detalleEnHtml(impresa), invitacion: invitacionEnHtml(impresa) };
  }
  if (c.canal === "vista-previa") {
    const vista = formaBife ? ({ tipo: "forma", presentacion: formaBife } as const) : ({ tipo: "sin-opciones" } as const);
    const html = renderToStaticMarkup(<VistaPreviaDeLaCarta nombre="Bife" sucursalNombre="Centro" vista={vista} />);
    const m = html.match(/<p data-incluye[^>]*>(.*?)<\/p>/);
    return { obtenido: { bife: m ? sinEtiquetas(m[1]!) : null, milanesa: null, bloque: bloqueEnHtml(html) }, detalle: detalleEnHtml(html), invitacion: invitacionEnHtml(html) };
  }
  // «Va a mostrar»: un texto. Sin opciones el administrador lee «Sin opciones.» (otra función, otra regla); con ellas, la oración de `vistaPreviaDeLaForma`.
  if (!formaBife) return { obtenido: { bife: null, milanesa: null, bloque: null }, oracion: "Va a mostrar «Bife» con su precio." };
  return { obtenido: { bife: null, milanesa: null, bloque: null }, oracion: vistaPreviaDeLaForma("Bife", formaBife) };
}

/** La oración que debe leer «Va a mostrar» según el oráculo (la plantilla la escribe el test: «el cuerpo, la línea del plato, el bloque y, si hay, el detalle»). */
function oracionEsperada(e: Esperado, detalle: string | null): string {
  const linea = e.bife ? ` · ${e.bife}` : "";
  // «papas fritas · papas rústicas con cáscara» (el oráculo) se lee en el texto como «papas fritas: papas rústicas con cáscara».
  const ver = detalle ? `. Ver detalle: ${detalle.replace(" · ", ": ")}` : "";
  const bloque = e.bloque ? ` · ${e.bloque.titulo}: ${e.bloque.opciones}. ${e.bloque.paraLosPlatos}${ver}` : "";
  return `Va a mostrar «Bife» con su precio${linea}${bloque}.`;
}

const nombreDe = (c: Combinacion) => `visible=${c.visible} opcion=${c.opcion} incluye=${c.incluye} cantidad=${c.cantidad} limites=${c.limites} canal=${c.canal} descripcion=${c.descripcion}`;

describe("carta «B»: el oráculo de combinaciones (escrito aparte, a mano)", () => {
  const todas = todasLasCombinaciones();

  it("el producto de las dimensiones tiene el tamaño declarado (un valor nuevo obliga a declararlo en el oráculo)", () => {
    expect(VISIBLE.length * OPCION.length * INCLUYE.length * CANTIDAD.length * LIMITES.length * CANAL.length * DESCRIPCION.length).toBe(TAMANO_DEL_PRODUCTO);
    expect(todas).toHaveLength(TAMANO_DEL_PRODUCTO);
  });

  it("cada combinación cae en UNA sola regla (ninguna sin regla, ninguna con dos)", () => {
    const sinRegla = todas.filter((c) => reglasQueAplican(c).length === 0).map(nombreDe);
    const dobles = todas.filter((c) => reglasQueAplican(c).length > 1).map((c) => `${nombreDe(c)} → ${reglasQueAplican(c).map((r) => r.nombre).join(" + ")}`);
    expect({ sinRegla, dobles }).toEqual({ sinRegla: [], dobles: [] });
    // Y toda regla se usa al menos una vez (una regla huérfana es una regla que nadie prueba).
    const huerfanas = REGLAS.filter((r) => !todas.some((c) => reglasQueAplican(c).includes(r))).map((r) => r.nombre);
    expect(huerfanas).toEqual([]);
  });

  it("E3: toda combinación cae en alguna regla del detalle y cada regla del detalle se usa (una regla huérfana no prueba nada)", () => {
    expect(todas.filter((c) => !REGLAS_DEL_DETALLE.some((r) => r.nombre === reglaDelDetalle(c).nombre))).toEqual([]);
    const usadas = new Set(todas.map((c) => reglaDelDetalle(c).nombre));
    expect(REGLAS_DEL_DETALLE.filter((r) => !usadas.has(r.nombre)).map((r) => r.nombre)).toEqual([]);
  });

  describe.each(todas.map((c) => [nombreDe(c), c] as const))("%s", (_nombre, c) => {
    it("lo que se lee en el canal es lo que dice la regla", () => {
      const [regla] = reglasQueAplican(c);
      const esperado = regla!.entonces;
      const { obtenido, oracion, detalle, invitacion } = leerElCanal(c);
      const reglaDetalle = reglaDelDetalle(c);
      const mensaje = `${nombreDe(c)} [${regla!.nombre}] [detalle: ${reglaDetalle.nombre}]`;
      if (oracion !== undefined) {
        expect(oracion, mensaje).toBe(oracionEsperada(esperado, reglaDetalle.detalle));
        return;
      }
      // E3: el desplegable «Ver detalle ▾» (solo pantalla) y la lista de papel (solo papel) existen juntos o no existen, con el mismo contenido y el rótulo genérico.
      expect(detalle, mensaje).toEqual(reglaDetalle.detalle === null ? { pantalla: null, rotulo: null, papel: null } : { pantalla: reglaDetalle.detalle, rotulo: "Ver detalle ▾", papel: reglaDetalle.detalle });
      // En los canales de vista previa solo se mira a Bife; en los de sección, a los dos.
      const esperadoDelCanal: Esperado = c.canal === "vista-previa" ? { ...esperado, milanesa: null } : esperado;
      // E2: solo la sección (pública e impresa) es interactiva: cada línea termina en «elegí abajo ↓» y el bloque dice «Va con: …»; la vista previa no tiene ni botones ni cue.
      const interactivo = c.canal === "publica" || c.canal === "impresa";
      const conCue = (linea: string | null) => (linea !== null && interactivo ? `${linea}${CUE_DE_LA_INVITACION}` : linea);
      expect(obtenido, mensaje).toEqual({ ...esperadoDelCanal, bife: conCue(esperadoDelCanal.bife), milanesa: conCue(esperadoDelCanal.milanesa) });
      const botonesEsperados = interactivo ? (esperadoDelCanal.bife === null ? 0 : (esperadoDelCanal.bife.match(/Incluye/g) ?? []).length) + (esperadoDelCanal.milanesa === null ? 0 : 1) : 0;
      expect(invitacion?.botones ?? 0, `${mensaje} [botones]`).toBe(botonesEsperados);
      expect(invitacion?.vaCon ?? null, `${mensaje} [va con]`).toBe(vaConEsperado(esperadoDelCanal, c.canal));
    });
  });

  it("un grupo oculto no deja ni el nombre del grupo ni sus opciones en ningún canal de pantalla o papel (ni descripciones)", () => {
    for (const c of todas.filter((x) => x.visible === "oculto" && (x.canal === "publica" || x.canal === "impresa"))) {
      const formaBife = formaDelPlato(gruposDelPlato(c, "bife"));
      const formaMilanesa = formaDelPlato(gruposDelPlato(c, "milanesa"));
      const html = renderToStaticMarkup(<Seccion seccion={seccionDe([itemDe("Bife", formaBife), itemDe("Milanesa", formaMilanesa)])} indice={0} total={1} estilo={ESTILO} />);
      expect(html, nombreDe(c)).not.toMatch(/Incluye|data-bloque-de-opciones|puré|ensalada|papas fritas/i);
    }
  });
});
