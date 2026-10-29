import { describe, expect, it } from "vitest";
import { presentacionDeUnProductoSolo } from "../../src/core/carta/public";
import { opcionesParaLaCarta } from "../../src/core/carta/opciones-en-carta";
import { MODOS_DE_VENTA, TIPOS_DE_GRUPO_DE_OPCIONES, validarAdmisionDeGrupo, validarVersion, type DiferenciaDePrecio, type TipoDeGrupoDeOpciones } from "../../src/core/opciones/public";
import { armarLineaConfigurada, type GrupoParaVender, type OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { resumenDePrecios, resumenDePreciosParaLaCarta, tablaDePreciosParaLaCarta, vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29), COMBINACIONES. Las dimensiones cuyas combinaciones cambian dinero, visibilidad o stock (D1 a D10 del diseño
 * `docs/diseno-ocultar-grupo-en-carta-2026-10-29.md`, sección D) se recorren enteras contra un ORÁCULO escrito acá, aparte del código: las funciones `esperaOcultarse` y las comparaciones entre corridas
 * NO llaman a `seOcultaEnLaCarta`. Un valor nuevo en una lista cerrada (un tipo de grupo, un modo de venta) cambia los CONTEOS declarados de abajo y obliga a declarar si afecta o no (no es un
 * guardián transversal nuevo: es el test de esta función).
 *
 * El oráculo (O1 a O5; O6 y O7 van en los tests con base del comando de admisión y de la Biblioteca):
 *  - O1 dinero: apagar el interruptor no cambia ningún número: el «desde», lo que se puede pedir, el conjunto de precios de la carta y el cobro (`armarLineaConfigurada`, `vistaPreviaDeConfiguracion`).
 *  - O2 visibilidad: el grupo falta en lo que lee la carta si y solo si el interruptor está apagado, es una VARIANTE o una INCLUIDA y no cambia el precio (incluido «el producto lo deja en 0 sobre
 *    una versión con precio»); en cualquier otro caso la salida es idéntica, byte a byte, a la del interruptor prendido.
 *  - O3 forma: si se oculta, la presentación es la del producto SIN ese grupo; «no se puede pedir» se sigue calculando con el producto completo (un grupo oculto obligatorio agotado saca al plato).
 *  - O4 agotado: con un grupo obligatorio y todas sus opciones agotadas hoy, el plato no aparece en la carta en pantalla y SÍ en la impresa (DEC-20), oculto o no.
 *  - O5 POS, stock, ticket y reportes no dependen del interruptor (los grupos con el interruptor apagado o prendido arman la misma línea y el mismo resumen).
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });
const pct = (p: number): DiferenciaDePrecio => ({ tipo: "PORCENTAJE", porcentaje: p });

type GrupoDeLaCarta = GrupoParaVender & { prefijoEnCarta?: string | null; seMuestraEnCarta?: boolean };

function opcion(opcionId: string, nombre: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre,
    orden: 0,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 3,
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

function grupo(grupoId: string, nombre: string, tipo: TipoDeGrupoDeOpciones, opciones: OpcionParaVender[], extra: Partial<GrupoDeLaCarta> = {}): GrupoDeLaCarta {
  return {
    grupoId,
    nombre,
    tipo,
    activo: true,
    admitido: true,
    cantidadMinima: tipo === "ADICIONAL" ? 0 : 1,
    cantidadMaxima: tipo === "ADICIONAL" ? 3 : 1,
    orden: 0,
    modoPrecio: tipo === "MEDIDA" ? "ABSOLUTO" : null,
    opciones: opciones.map((o, i) => ({ ...o, orden: i })),
    ...extra,
  };
}

/** Todo lo que lee la carta de un producto: el resumen, las opciones, la tabla de precios y la forma (la misma cadena que la carta pública, la impresa, la vista previa y «Va a mostrar»). */
function leerLaCarta(grupos: readonly GrupoDeLaCarta[], p: { precioBase: number; esBase: boolean; descuentoDeProducto: number | null }) {
  const resumen = resumenDePreciosParaLaCarta({ grupos, ...p });
  const enCarta = opcionesParaLaCarta(resumen);
  const tabla = tablaDePreciosParaLaCarta({ grupos, ...p });
  const forma = tabla ? presentacionDeUnProductoSolo({ tabla, esBase: p.esBase, mostrarNombreArriba: false, conDescuento: p.descuentoDeProducto !== null }) : null;
  return { resumen, enCarta, tabla, forma };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Las dimensiones

const D1_TIPO = TIPOS_DE_GRUPO_DE_OPCIONES;
const D2_SE_MUESTRA = [true, false] as const;
const D3_EFECTO = ["neutro", "monto-de-la-version", "monto-del-producto", "porcentaje", "producto-en-cero-sobre-version-con-precio", "precio-propio"] as const;
const D4_MODO = MODOS_DE_VENTA;
const D5_CANTIDADES = [
  { min: 1, max: 1 },
  { min: 0, max: 1 },
  { min: 0, max: 3 },
] as const;
const D6_PREFIJO = [null, "De"] as const;
const D7_OTRO_GRUPO = ["ninguno", "medida-que-define-el-precio", "variante-con-costo", "incluida", "adicional"] as const;
const D8_AGOTADO = ["ninguna", "una", "todas"] as const;
const D9_DESCUENTO = [null, 10] as const;

/** El efecto que SÍ es neutro para el precio dentro del producto (el oráculo, escrito a mano: no llama a la regla del código). */
const EFECTOS_NEUTROS: readonly (typeof D3_EFECTO)[number][] = ["neutro", "producto-en-cero-sobre-version-con-precio"];

interface Combinacion {
  tipo: TipoDeGrupoDeOpciones;
  efecto: (typeof D3_EFECTO)[number];
  modo: (typeof D4_MODO)[number];
  cantidades: (typeof D5_CANTIDADES)[number];
  prefijo: (typeof D6_PREFIJO)[number];
  otro: (typeof D7_OTRO_GRUPO)[number];
  agotado: (typeof D8_AGOTADO)[number];
  descuento: (typeof D9_DESCUENTO)[number];
}

/** Las dos opciones del grupo bajo prueba («A» lleva el efecto de D3; «B» es neutra, salvo en un adicional, que siempre cobra algo) y su admisión tal como la validaría el comando. */
function opcionesDelGrupo(c: Combinacion): OpcionParaVender[] {
  const ancla = c.tipo === "ADICIONAL" ? { productoAnclaId: "p-ancla" } : {};
  const cantidadMaxima = c.tipo === "MEDIDA" ? 1 : c.cantidades.max;
  const efecto: Partial<OpcionParaVender> =
    c.efecto === "neutro"
      ? {}
      : c.efecto === "monto-de-la-version"
        ? { diferenciaDeLaVersion: monto(500) }
        : c.efecto === "monto-del-producto"
          ? { diferenciaDelProducto: monto(500) }
          : c.efecto === "porcentaje"
            ? { diferenciaDeLaVersion: pct(10) }
            : c.efecto === "producto-en-cero-sobre-version-con-precio"
              ? { diferenciaDeLaVersion: monto(500), diferenciaDelProducto: monto(0) }
              : { precioAbsoluto: 500 };
  if (c.tipo === "MEDIDA") {
    // Un tamaño con precio propio: «precio-propio» es el único que lo cambia entre A y B; en los demás los dos valen lo mismo (el efecto se carga igual y la validación descarta lo inválido).
    const a = opcion("A", "A", { cantidadMaxima, ...efecto, precioAbsoluto: 4000 });
    const b = opcion("B", "B", { cantidadMaxima, precioAbsoluto: c.efecto === "precio-propio" ? 4300 : 4000 });
    return [a, b];
  }
  const baseB = c.tipo === "ADICIONAL" ? { diferenciaDeLaVersion: monto(300) } : {};
  return [opcion("A", "A", { cantidadMaxima, ...ancla, ...efecto }), opcion("B", "B", { cantidadMaxima, ...ancla, ...baseB })];
}

/** Descarta las combinaciones que el sistema no deja guardar (las mismas reglas del comando: `validarAdmisionDeGrupo` y `validarVersion`). */
function esValida(c: Combinacion): boolean {
  const opciones = opcionesDelGrupo(c);
  const admision = validarAdmisionDeGrupo({
    grupo: { tipo: c.tipo, cantidadMinima: c.cantidades.min, cantidadMaxima: c.cantidades.max },
    opcionesDelGrupo: opciones.map((o) => ({ opcionId: o.opcionId, nombre: o.nombre, activa: true, esNinguna: false })),
    admision: { cantidadMinima: null, cantidadMaxima: null, modoPrecio: c.tipo === "MEDIDA" ? "ABSOLUTO" : null, activo: true },
    opciones: opciones.map((o) => ({ opcionId: o.opcionId, cantidadMaxima: o.cantidadMaxima, precioAbsoluto: o.precioAbsoluto, diferencia: o.diferenciaDelProducto, activo: true })),
  });
  if (!admision.ok) return false;
  // Una MEDIDA lleva precio propio: la diferencia de su versión no se cobra (se carga igual); `validarVersion` solo importa en los demás tipos.
  return opciones.every((o) => validarVersion(c.tipo, false, { diferencia: o.diferenciaDeLaVersion, factorEscala: null }).ok || c.tipo === "MEDIDA");
}

/** Los grupos del producto: el que se prueba (con el interruptor dado) y «otro grupo» (D7). */
function gruposDe(c: Combinacion, seMuestraEnCarta: boolean, conAgotado: boolean): GrupoDeLaCarta[] {
  const opciones = opcionesDelGrupo(c).map((o, i) => ({ ...o, apagadaEnSucursal: conAgotado && (c.agotado === "todas" || (c.agotado === "una" && i === 0)) }));
  const g = grupo("g-x", "Grupo X", c.tipo, opciones, { cantidadMinima: c.cantidades.min, cantidadMaxima: c.cantidades.max, prefijoEnCarta: c.prefijo, seMuestraEnCarta, orden: 0 });
  const otro: GrupoDeLaCarta[] =
    c.otro === "ninguno"
      ? []
      : c.otro === "medida-que-define-el-precio"
        ? [grupo("g-otro", "Tamaño", "MEDIDA", [opcion("T1", "Chico", { precioAbsoluto: 4000 }), opcion("T2", "Grande", { precioAbsoluto: 4300 })], { orden: 1 })]
        : c.otro === "variante-con-costo"
          ? [grupo("g-otro", "Preparación", "VARIANTE", [opcion("P1", "Normal"), opcion("P2", "Especial", { diferenciaDeLaVersion: monto(200) })], { orden: 1 })]
          : c.otro === "incluida"
            ? [grupo("g-otro", "Guarnición", "INCLUIDA", [opcion("G1", "Papas"), opcion("G2", "Puré")], { orden: 1 })]
            : [grupo("g-otro", "Extras", "ADICIONAL", [opcion("E1", "Huevo", { productoAnclaId: "p-huevo", diferenciaDeLaVersion: monto(600) })], { orden: 1 })];
  return [g, ...otro];
}

/** Lo que un mozo elegiría: la primera opción de cada grupo obligatorio (sirve para comparar el cobro, ande o rechace). */
const elegidasDe = (grupos: readonly GrupoDeLaCarta[]) => grupos.filter((g) => g.cantidadMinima > 0).flatMap((g) => g.opciones.slice(0, Math.max(1, g.cantidadMinima)).map((o) => ({ opcionId: o.opcionId, cantidad: 1 })));

/** El oráculo de O2 (a mano): ¿debe faltar el grupo en lo que lee la carta? */
const esperaOcultarse = (c: Combinacion, seMuestra: boolean) => !seMuestra && (c.tipo === "VARIANTE" || c.tipo === "INCLUIDA") && EFECTOS_NEUTROS.includes(c.efecto);

const PRECIO_BASE = 5000;

/**
 * Los NÚMEROS DECLARADOS del recorrido (si cambian, es porque cambió una dimensión o una regla: se declara a propósito, no se ajusta a ciegas). De las 8.640 combinaciones (sin D2, que se corre
 * con sus dos valores), el sistema no deja guardar 5.880 (tipos y cantidades que no se combinan, precios propios fuera de una medida, adicionales sin recargo, diferencias en una incluida) y quedan 2.760.
 * `OCULTABLES`: las válidas en que el oráculo espera que el grupo desaparezca con el interruptor apagado. `O4_EJERCIDAS`: las de O4 que de verdad se pueden pedir en la impresa.
 */
const DESCARTADAS = 5880;
const VALIDAS = 2760;
const OCULTABLES = 840;
const O4_EJERCIDAS = 296;

describe("Combinaciones de «Mostrar este grupo en la carta» contra el oráculo O1 a O5", () => {
  const todas: Combinacion[] = [];
  for (const tipo of D1_TIPO) for (const efecto of D3_EFECTO) for (const modo of D4_MODO) for (const cantidades of D5_CANTIDADES) for (const prefijo of D6_PREFIJO) for (const otro of D7_OTRO_GRUPO) for (const agotado of D8_AGOTADO) for (const descuento of D9_DESCUENTO) {
    todas.push({ tipo, efecto, modo, cantidades, prefijo, otro, agotado, descuento });
  }
  // D2 (el interruptor) NO está en la lista: cada combinación se corre con los dos valores y se COMPARAN las dos corridas.
  const validas = todas.filter(esValida);

  it("cuenta las combinaciones recorridas y descartadas (un valor nuevo en una dimensión cambia estos números y obliga a declararlo)", () => {
    expect({ dimensiones: { D1: D1_TIPO.length, D2: D2_SE_MUESTRA.length, D3: D3_EFECTO.length, D4: D4_MODO.length, D5: D5_CANTIDADES.length, D6: D6_PREFIJO.length, D7: D7_OTRO_GRUPO.length, D8: D8_AGOTADO.length, D9: D9_DESCUENTO.length } }).toEqual({
      dimensiones: { D1: 4, D2: 2, D3: 6, D4: 2, D5: 3, D6: 2, D7: 5, D8: 3, D9: 2 },
    });
    expect({ recorridas: todas.length, descartadas: todas.length - validas.length, validas: validas.length }).toEqual({ recorridas: 8640, descartadas: DESCARTADAS, validas: VALIDAS });
    expect(validas.filter((c) => esperaOcultarse(c, false)).length).toBe(OCULTABLES);
  });

  it("O1 a O5 en todas las combinaciones válidas", () => {
    let o4Ejercidas = 0;
    for (const c of validas) {
      const esBase = c.modo === "BASE_CONFIGURABLE";
      const p = { precioBase: PRECIO_BASE, esBase, descuentoDeProducto: c.descuento };
      const etiqueta = JSON.stringify(c);
      const si = leerLaCarta(gruposDe(c, true, true), p);
      const no = leerLaCarta(gruposDe(c, false, true), p);
      const ocultar = esperaOcultarse(c, false);

      // O1 (dinero): el «desde», lo que se puede pedir y el conjunto de precios de la carta no cambian; el cobro es idéntico.
      expect({ desde: no.resumen.desde, vendible: no.resumen.vendible, hayVariacion: no.resumen.hayVariacion }, etiqueta).toEqual({ desde: si.resumen.desde, vendible: si.resumen.vendible, hayVariacion: si.resumen.hayVariacion });
      // Los precios de la tabla: iguales; salvo que, con el grupo a la vista, otro grupo que cambia el precio no tenía lugar en la tabla (`sinLugar`: la carta no podía leer el producto con precio exacto
      // y salía «como antes»). Al ocultar el grupo que ocupaba el lugar, ese otro grupo pasa a ser un eje y la carta muestra sus precios reales: aparecen precios que el plato ya tenía, ninguno se mueve.
      const preciosSi = new Set((si.tabla?.celdas ?? []).flat());
      const preciosNo = new Set((no.tabla?.celdas ?? []).flat());
      if (si.tabla && si.tabla.ejes.sinLugar.length === 0) expect(preciosNo, etiqueta).toEqual(preciosSi);
      else for (const precio of preciosSi) expect(preciosNo.has(precio), `${etiqueta}: el precio ${precio} sigue estando`).toBe(true);
      expect(no.enCarta === null, etiqueta).toBe(si.enCarta === null); // O3: «no se puede pedir» no depende del interruptor.
      expect(no.tabla === null, etiqueta).toBe(si.tabla === null);

      // O2 (visibilidad): falta si y solo si el oráculo lo dice; si no, la salida es idéntica byte a byte.
      expect(no.resumen.grupos.some((g) => g.grupoId === "g-x"), etiqueta).toBe(!ocultar);
      expect(si.resumen.grupos.some((g) => g.grupoId === "g-x"), etiqueta).toBe(true);
      expect(no.tabla?.grupos.some((g) => g.grupoId === "g-x") ?? false, etiqueta).toBe(si.tabla ? !ocultar : false);
      if (!ocultar) expect(JSON.stringify(no), etiqueta).toBe(JSON.stringify(si));

      // O3 (forma): lo que se ve es el producto SIN el grupo (cuando se puede pedir con el producto completo).
      if (ocultar && si.enCarta !== null) {
        const sinElGrupo = leerLaCarta(gruposDe(c, true, true).filter((g) => g.grupoId !== "g-x"), p);
        expect(no.forma, etiqueta).toEqual(sinElGrupo.forma);
        expect(no.enCarta?.grupos, etiqueta).toEqual(sinElGrupo.enCarta?.grupos);
        expect(no.enCarta?.sinCosto, etiqueta).toEqual(sinElGrupo.enCarta?.sinCosto);
      }

      // O4 (agotado): un grupo obligatorio con todo agotado saca al plato de la carta en pantalla, oculto o no; la impresa (sin lo agotado hoy) sale como si nada estuviera agotado (DEC-20).
      if (c.agotado === "todas" && c.cantidades.min > 0) {
        expect(no.enCarta, etiqueta).toBeNull();
        expect(si.enCarta, etiqueta).toBeNull();
        const impresa = leerLaCarta(gruposDe(c, false, false), p);
        const sinNadaAgotado = leerLaCarta(gruposDe({ ...c, agotado: "ninguna" }, false, true), p);
        expect(impresa.enCarta, etiqueta).toEqual(sinNadaAgotado.enCarta);
        expect(impresa.forma, etiqueta).toEqual(sinNadaAgotado.forma);
        if (impresa.enCarta !== null) o4Ejercidas++;
      }

      // O5 (POS, stock, ticket y reportes): el cobro, la vista previa del diálogo y el resumen completo no leen el interruptor.
      const gSi = gruposDe(c, true, true);
      const gNo = gruposDe(c, false, true);
      const elegidas = elegidasDe(gSi);
      const entradaDeLinea = (grupos: GrupoDeLaCarta[]) => ({ grupos, elegidas, precioBase: PRECIO_BASE, descuentoDeProducto: c.descuento, cantidad: 2 });
      expect(armarLineaConfigurada(entradaDeLinea(gNo)), etiqueta).toEqual(armarLineaConfigurada(entradaDeLinea(gSi)));
      expect(vistaPreviaDeConfiguracion(entradaDeLinea(gNo)), etiqueta).toEqual(vistaPreviaDeConfiguracion(entradaDeLinea(gSi)));
      expect(resumenDePrecios({ grupos: gNo, precioBase: PRECIO_BASE, descuentoDeProducto: c.descuento, esBase }), etiqueta).toEqual(resumenDePrecios({ grupos: gSi, precioBase: PRECIO_BASE, descuentoDeProducto: c.descuento, esBase }));
    }
    // Que O4 no sea vacuo: cuántas combinaciones tenían un grupo obligatorio agotado del todo y un producto que se puede pedir en la impresa.
    expect(o4Ejercidas).toBe(O4_EJERCIDAS);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Filas literales: la salida esperada escrita a mano

const BIFE = { precioBase: 20000, esBase: false, descuentoDeProducto: null };

const corte = (tipo: "VARIANTE" | "INCLUIDA" | "ADICIONAL", extra: Partial<GrupoDeLaCarta> = {}, opciones: OpcionParaVender[] = [opcion("o-ojo", "Ojo de bife"), opcion("o-chorizo", "Bife de chorizo")]) =>
  grupo("g-corte", "Corte", tipo, opciones, extra);
const guarnicion = () => grupo("g-guarnicion", "Guarnición", "INCLUIDA", [opcion("o-ensalada", "Ensalada"), opcion("o-papas", "Papas fritas"), opcion("o-pure", "Puré")], { orden: 1 });
const agotada = (o: OpcionParaVender): OpcionParaVender => ({ ...o, apagadaEnSucursal: true });

describe("Filas literales del bife (el caso del dueño): la salida esperada está escrita a mano", () => {
  const fila = (caso: string, grupos: GrupoDeLaCarta[], esperado: unknown, p = BIFE) => ({ caso, grupos, esperado, p });
  const FILAS = [
    fila("1. Corte como incluida, mostrado: una línea «Corte: …»", [corte("INCLUIDA")], { presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "Corte", opciones: ["ojo de bife", "bife de chorizo"] }] }, rotulos: [] }),
    fila("2. Corte como incluida, oculto: «Bife $X» sin aclaraciones", [corte("INCLUIDA", { seMuestraEnCarta: false })], { presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] }),
    fila("3. Corte como variante obligatoria, oculto: «Bife $X» sin aclaraciones", [corte("VARIANTE", { seMuestraEnCarta: false })], { presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] }),
    fila("4. Corte como variante opcional (0..1), oculto: sin aclaraciones", [corte("VARIANTE", { seMuestraEnCarta: false, cantidadMinima: 0 })], { presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] }),
    fila(
      "5. Corte con prefijo «De» (variante 1..1), mostrado: una fila por corte con el nombre arriba",
      [corte("VARIANTE", { prefijoEnCarta: "De" })],
      { presentacion: { forma: "lista", encabezado: true, filas: [{ rotulo: "De ojo de bife", precio: 20000 }, { rotulo: "De bife de chorizo", precio: 20000 }], aclaraciones: [] }, rotulos: [] }
    ),
    fila("6. El mismo corte con prefijo, oculto: vuelve a «Bife $X»", [corte("VARIANTE", { prefijoEnCarta: "De", seMuestraEnCarta: false })], { presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] }),
    fila(
      "7. Corte oculto pero con +$2.000 en «Ojo de bife» (apareció un precio): la carta lo muestra igual",
      [corte("VARIANTE", { seMuestraEnCarta: false }, [opcion("o-ojo", "Ojo de bife", { diferenciaDeLaVersion: monto(2000) }), opcion("o-chorizo", "Bife de chorizo")])],
      { presentacion: { forma: "lista", encabezado: true, filas: [{ rotulo: "Ojo de bife", precio: 22000 }, { rotulo: "Bife de chorizo", precio: 20000 }], aclaraciones: [] }, rotulos: [] }
    ),
    fila(
      "8. Corte oculto y Guarnición mostrada: queda solo la línea de la guarnición",
      [corte("INCLUIDA", { seMuestraEnCarta: false }), guarnicion()],
      { presentacion: { forma: "simple", aclaraciones: [{ tipo: "eleccion", rotulo: "Guarnición", opciones: ["ensalada", "papas fritas", "puré"] }] }, rotulos: [] }
    ),
    fila(
      "9. Corte oculto y un ADICIONAL «Extras»: el adicional sigue con su recargo",
      [corte("INCLUIDA", { seMuestraEnCarta: false }), grupo("g-extras", "Extras", "ADICIONAL", [opcion("o-huevo", "Huevo frito", { productoAnclaId: "p-huevo", diferenciaDeLaVersion: monto(1500) })], { orden: 1 })],
      { presentacion: { forma: "simple", aclaraciones: [{ tipo: "extras", rotulo: "Extras", opciones: [{ nombre: "huevo frito", recargo: 1500 }] }] }, rotulos: [] }
    ),
    fila(
      "10. Un corte agotado hoy y el otro no, oculto: el plato sigue en la carta («Bife $X»)",
      [corte("INCLUIDA", { seMuestraEnCarta: false }, [agotada(opcion("o-ojo", "Ojo de bife")), opcion("o-chorizo", "Bife de chorizo")])],
      { presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] }
    ),
    fila(
      "11. Un grupo de adicionales no se oculta aunque el interruptor esté apagado",
      [corte("ADICIONAL", { seMuestraEnCarta: false }, [opcion("o-ojo", "Ojo de bife", { productoAnclaId: "p-ojo", diferenciaDeLaVersion: monto(500) })])],
      { presentacion: { forma: "simple", aclaraciones: [{ tipo: "extras", rotulo: "Corte", opciones: [{ nombre: "ojo de bife", recargo: 500 }] }] }, rotulos: [] }
    ),
    fila(
      "12. El caso de producción («se vende por opción»): Preparación define el plato, Proteína oculta y Guarniciones mostrada",
      [
        grupo("g-prep", "Preparación del bife", "MEDIDA", [opcion("o-criolla", "A criolla", { precioAbsoluto: 30000 }), opcion("o-chimi", "Con chimichurri", { precioAbsoluto: 30000 })]),
        grupo("g-prot", "Proteína del bife", "INCLUIDA", [opcion("o-nalga", "Nalga"), opcion("o-chorizo", "Bife de chorizo")], { orden: 1, seMuestraEnCarta: false }),
        grupo("g-guar", "Guarniciones", "INCLUIDA", [opcion("o-ensalada", "Ensalada"), opcion("o-papas", "Papas fritas")], { orden: 2 }),
      ],
      {
        presentacion: {
          forma: "lista",
          encabezado: false,
          filas: [{ rotulo: "A criolla", precio: 30000 }, { rotulo: "Con chimichurri", precio: 30000 }],
          aclaraciones: [{ tipo: "eleccion", rotulo: "Guarniciones", opciones: ["ensalada", "papas fritas"] }],
        },
        rotulos: [],
      },
      { precioBase: 0, esBase: true, descuentoDeProducto: null }
    ),
  ];

  for (const f of FILAS) {
    it(f.caso, () => {
      const { forma } = leerLaCarta(f.grupos, f.p);
      expect(forma).toEqual(f.esperado);
    });
  }

  it("13. Corte oculto y los dos cortes agotados hoy: el plato sale de la carta en pantalla y sigue en la impresa", () => {
    const grupos = (conAgotado: boolean) => [corte("INCLUIDA", { seMuestraEnCarta: false }, [opcion("o-ojo", "Ojo de bife", { apagadaEnSucursal: conAgotado }), opcion("o-chorizo", "Bife de chorizo", { apagadaEnSucursal: conAgotado })])];
    expect(leerLaCarta(grupos(true), BIFE).enCarta).toBeNull();
    expect(leerLaCarta(grupos(true), BIFE).forma).toBeNull();
    expect(leerLaCarta(grupos(false), BIFE).forma).toEqual({ presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] });
  });

  it("14. Ocultar no mueve el «desde» ni el precio: «Bife $20.000» con y sin el interruptor", () => {
    for (const seMuestraEnCarta of [true, false]) {
      const r = leerLaCarta([corte("INCLUIDA", { seMuestraEnCarta })], BIFE);
      expect(r.enCarta?.desde).toBe(20000);
      expect(r.tabla?.celdas).toEqual([[20000]]);
    }
  });
});

describe("Filas literales del café (columnas Chico | Mediano | Grande, MEDIDA): la grilla no cambia con el interruptor", () => {
  const CAFE = { precioBase: 4000, esBase: false, descuentoDeProducto: null };
  const tamano = (extra: Partial<GrupoDeLaCarta> = {}) =>
    grupo("g-tamano", "Tamaño del café", "MEDIDA", [opcion("o-chico", "Chico", { precioAbsoluto: 4000 }), opcion("o-mediano", "Mediano", { precioAbsoluto: 4100 }), opcion("o-grande", "Grande", { precioAbsoluto: 4300 })], extra);
  const leche = (extra: Partial<GrupoDeLaCarta> = {}, opciones: OpcionParaVender[] = [opcion("o-entera", "Entera"), opcion("o-desla", "Deslactosada")]) => grupo("g-leche", "Leche", "VARIANTE", opciones, { orden: 1, ...extra });
  const COLUMNAS = ["Chico", "Mediano", "Grande"];
  const GRILLA = [4000, 4100, 4300];
  const LINEA_DE_LECHE = { tipo: "eleccion", rotulo: "Leche", opciones: ["entera", "deslactosada"] };

  it("C1. Leche sin costo, mostrada: la grilla y una línea «Leche: entera o deslactosada»", () => {
    expect(leerLaCarta([tamano(), leche()], CAFE).forma).toEqual({ presentacion: { forma: "columnas", celdas: GRILLA, aclaraciones: [LINEA_DE_LECHE] }, rotulos: COLUMNAS });
  });

  it("C2. Leche sin costo, oculta: la MISMA grilla y solo se va la línea de la leche", () => {
    expect(leerLaCarta([tamano(), leche({ seMuestraEnCarta: false })], CAFE).forma).toEqual({ presentacion: { forma: "columnas", celdas: GRILLA, aclaraciones: [] }, rotulos: COLUMNAS });
  });

  it("C3. El tamaño (MEDIDA) no se oculta: con el interruptor apagado la grilla y la leche salen igual que en C1", () => {
    expect(leerLaCarta([tamano({ seMuestraEnCarta: false }), leche()], CAFE).forma).toEqual({ presentacion: { forma: "columnas", celdas: GRILLA, aclaraciones: [LINEA_DE_LECHE] }, rotulos: COLUMNAS });
  });

  it("C4. Leche con recargo (+$300 la vegetal), apagada: la carta la muestra igual como segunda entrada de la tabla", () => {
    const conRecargo = leche({ seMuestraEnCarta: false }, [opcion("o-entera", "Entera"), opcion("o-vegetal", "Vegetal", { diferenciaDeLaVersion: monto(300) })]);
    expect(leerLaCarta([tamano(), conRecargo], CAFE).forma).toEqual({
      presentacion: {
        forma: "tabla",
        columnas: COLUMNAS,
        filas: [
          { rotulo: "Entera", celdas: [4000, 4100, 4300] },
          { rotulo: "Vegetal", celdas: [4300, 4400, 4600] },
        ],
        aclaraciones: [],
      },
      rotulos: [],
    });
  });

  it("C5. Con descuento de producto del 10 %, ocultar la leche tampoco mueve ni un precio de la grilla", () => {
    const conDescuento = { ...CAFE, descuentoDeProducto: 10 };
    const mostrada = leerLaCarta([tamano(), leche()], conDescuento);
    const oculta = leerLaCarta([tamano(), leche({ seMuestraEnCarta: false })], conDescuento);
    expect(oculta.tabla?.celdas).toEqual(mostrada.tabla?.celdas);
    expect(oculta.tabla?.celdas).toEqual([[3600, 3690, 3870]]);
    expect(oculta.enCarta?.desde).toBe(mostrada.enCarta?.desde);
  });
});
