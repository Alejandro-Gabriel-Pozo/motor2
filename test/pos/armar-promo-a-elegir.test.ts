import { describe, expect, it } from "vitest";
import { eleccionParaAgregar, estadoInicialArmarPromo, gruposQueFaltanDeUnidad, puedeConfirmarArmarPromo, reducirArmarPromo, totalElegidoDelCupo, unidadesDeEntrada, type AccionArmarPromo, type EstadoArmarPromo } from "../../src/core/pos/armar-promo-estado";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import type { EntradaPromoSelectorCarta } from "../../src/core/pos/selector-carta";

/**
 * Promo «a elegir», PR C (selector del POS; diseño 2026-11-04 §7 y §11 nivel 8): el reductor de «Armar promo» con una entrada que el mozo configura. Es el bife real de la empresa: Proteína (incluida,
 * 1 de 2), Preparación (medida, 1 de 2) y Guarniciones (variante, hasta 2 de 3). Fija: cada «+» suma una unidad con sus propias opciones; la unidad cuenta para el máximo del cupo; «Agregar promo» espera
 * a que cada unidad cumpla los mínimos de sus grupos; las unidades con la misma configuración viajan en UNA fila (el servidor rechaza dos filas iguales); una entrada de configuración fija se comporta
 * como siempre; solo se elige entre lo que la lectura ofrece (lo permitido efectivo), con la versión que el mozo vio.
 *
 * Mutaciones demostradas (rojo y revertidas): no contar las unidades «a elegir» en el total del cupo (rojo: «cuenta para el máximo»); no exigir los mínimos de los grupos al confirmar (rojo: «no deja
 * confirmar»); mandar dos filas iguales en vez de juntarlas (rojo: «junta»).
 */
const opcion = (opcionId: string, nombre: string, orden: number, extra: Partial<OpcionParaVender> = {}): OpcionParaVender => ({
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
  diferenciaDeLaVersion: { tipo: "MONTO", monto: 0 },
  factorEscala: null,
  consumos: [],
  precioAbsoluto: null,
  diferenciaDelProducto: null,
  precioDeSucursal: null,
  ...extra,
});
const grupo = (grupoId: string, tipo: GrupoParaVender["tipo"], cantidadMinima: number, cantidadMaxima: number, opciones: OpcionParaVender[]): GrupoParaVender => ({
  grupoId,
  nombre: grupoId,
  tipo,
  activo: true,
  admitido: true,
  cantidadMinima,
  cantidadMaxima,
  orden: 0,
  modoPrecio: tipo === "MEDIDA" ? "DIFERENCIA" : null,
  opciones,
});

const GRUPOS_BIFE = [
  grupo("Proteína", "INCLUIDA", 1, 1, [opcion("nalga", "Nalga", 1), opcion("chorizo", "Bife de chorizo", 2)]),
  grupo("Preparación", "MEDIDA", 1, 1, [opcion("criolla", "Bife a la criolla", 1), opcion("chimi", "Bife con chimichurri", 2)]),
  grupo("Guarniciones", "VARIANTE", 0, 2, [opcion("pure", "Puré de papa", 1), opcion("ensalada", "Ensalada", 2), opcion("papas", "Papas fritas", 3)]),
];

const promo = (): EntradaPromoSelectorCarta => ({
  tipo: "promo",
  promoCartaId: "p-bife",
  titulo: "Bife con guarnición",
  precio: 55000,
  cupos: [
    {
      cupoId: "c-plato",
      tipo: "LISTA",
      nombre: "Plato principal",
      cantidadMinima: 1,
      cantidadMaximaCupo: 2,
      fijo: false,
      entradas: [
        { entradaId: "e-bife", productoId: "bife", nombre: "Bife", precioLista: 40000, grupos: GRUPOS_BIFE },
        { entradaId: "e-milanesa", productoId: "mila", nombre: "Milanesa · Napolitana", precioLista: 30000 },
      ],
    },
  ],
});

const correr = (acciones: AccionArmarPromo[], desde: EstadoArmarPromo = estadoInicialArmarPromo(promo())) => acciones.reduce(reducirArmarPromo, desde);
const mas = (entradaId: string): AccionArmarPromo => ({ tipo: "incrementar", seccionCartaId: "c-plato", productoId: entradaId });
const menos = (entradaId: string): AccionArmarPromo => ({ tipo: "decrementar", seccionCartaId: "c-plato", productoId: entradaId });
const opcionDe = (uid: number, accion: "elegir" | "sumar" | "restar", grupoId: string, opcionId: string): AccionArmarPromo => ({ tipo: "opcion", seccionCartaId: "c-plato", uid, accion, grupoId, opcionId });
const bifeCompleto = (uid: number, proteina = "nalga", preparacion = "criolla"): AccionArmarPromo[] => [opcionDe(uid, "elegir", "Proteína", proteina), opcionDe(uid, "elegir", "Preparación", preparacion)];

describe("Armar promo «a elegir» (PR C, selector del POS)", () => {
  it("cada «+» suma una unidad con sus opciones por elegir, y cuenta para el máximo del cupo", () => {
    const e = correr([mas("e-bife"), mas("e-bife"), mas("e-bife")]);
    expect(unidadesDeEntrada(e, "c-plato", "e-bife").map((u) => u.uid)).toEqual([1, 2]);
    expect(totalElegidoDelCupo(e, "c-plato")).toBe(2); // cuenta para el máximo: la tercera no entra
  });

  it("no deja confirmar hasta que la unidad cumple los mínimos de sus grupos (y dice cuáles faltan)", () => {
    const sinNada = correr([mas("e-bife")]);
    expect(puedeConfirmarArmarPromo(sinNada)).toBe(false);
    const unidad = unidadesDeEntrada(sinNada, "c-plato", "e-bife")[0]!;
    expect(gruposQueFaltanDeUnidad(GRUPOS_BIFE, unidad).map((g) => g.nombre)).toEqual(["Proteína", "Preparación"]);
    expect(puedeConfirmarArmarPromo(correr([mas("e-bife"), opcionDe(1, "elegir", "Proteína", "nalga")]))).toBe(false);
    expect(puedeConfirmarArmarPromo(correr([mas("e-bife"), ...bifeCompleto(1)]))).toBe(true); // Guarniciones es opcional
  });

  it("un grupo de una sola elección cambia de opción en vez de sumar; uno de varias respeta el máximo del grupo", () => {
    const e = correr([mas("e-bife"), ...bifeCompleto(1), opcionDe(1, "elegir", "Proteína", "chorizo"), opcionDe(1, "sumar", "Guarniciones", "pure"), opcionDe(1, "sumar", "Guarniciones", "ensalada"), opcionDe(1, "sumar", "Guarniciones", "papas")]);
    expect(unidadesDeEntrada(e, "c-plato", "e-bife")[0]!.elegidas).toEqual({ chorizo: 1, criolla: 1, pure: 1, ensalada: 1 });
  });

  it("solo acepta opciones que la lectura ofrece para esa entrada (una de otro grupo o inventada no entra)", () => {
    const e = correr([mas("e-bife"), opcionDe(1, "elegir", "Proteína", "ojo-de-bife"), opcionDe(1, "elegir", "NoExiste", "nalga"), opcionDe(99, "elegir", "Proteína", "nalga")]);
    expect(unidadesDeEntrada(e, "c-plato", "e-bife")[0]!.elegidas).toEqual({});
  });

  it("«−» saca la última unidad de esa entrada; en una entrada fija sigue sumando cantidades como siempre", () => {
    const e = correr([mas("e-bife"), mas("e-milanesa"), menos("e-bife")]);
    expect(unidadesDeEntrada(e, "c-plato", "e-bife")).toEqual([]);
    expect(totalElegidoDelCupo(e, "c-plato")).toBe(1);
    expect(eleccionParaAgregar(e)).toEqual([{ cupoId: "c-plato", elegidos: [{ entradaId: "e-milanesa", cantidad: 1 }] }]);
  });

  it("viaja con las opciones y la versión que el mozo vio; las unidades con la misma configuración se juntan en UNA fila", () => {
    const e = correr([mas("e-bife"), ...bifeCompleto(1), opcionDe(1, "sumar", "Guarniciones", "pure"), mas("e-bife"), opcionDe(2, "sumar", "Guarniciones", "pure"), ...bifeCompleto(2)]);
    expect(puedeConfirmarArmarPromo(e)).toBe(true);
    const fila = { entradaId: "e-bife", cantidad: 2, opciones: [{ opcionId: "nalga", cantidad: 1, versionDeOpcionId: "v-nalga" }, { opcionId: "criolla", cantidad: 1, versionDeOpcionId: "v-criolla" }, { opcionId: "pure", cantidad: 1, versionDeOpcionId: "v-pure" }] };
    expect(eleccionParaAgregar(e)).toEqual([{ cupoId: "c-plato", elegidos: [fila] }]);
  });

  it("dos configuraciones distintas del mismo plato viajan en dos filas, y el plato fijo en la suya", () => {
    const e = correr([mas("e-bife"), ...bifeCompleto(1), mas("e-bife"), ...bifeCompleto(2, "chorizo", "chimi")]);
    const [cupo] = eleccionParaAgregar(e);
    expect(cupo).toMatchObject({ cupoId: "c-plato" });
    expect((cupo as { elegidos: unknown[] }).elegidos).toHaveLength(2);
    expect(totalElegidoDelCupo(e, "c-plato")).toBe(2);
  });

  it("una unidad sin completar bloquea aunque la otra esté lista; sacar la incompleta destraba", () => {
    const e = correr([mas("e-bife"), ...bifeCompleto(1), mas("e-bife")]);
    expect(puedeConfirmarArmarPromo(e)).toBe(false);
    expect(puedeConfirmarArmarPromo(reducirArmarPromo(e, menos("e-bife")))).toBe(true);
  });

  it("una opción obligatoria no se puede dejar vacía tocando la elegida de nuevo: se cambia eligiendo otra", () => {
    const e = correr([mas("e-bife"), ...bifeCompleto(1), opcionDe(1, "elegir", "Preparación", "chimi")]);
    expect(unidadesDeEntrada(e, "c-plato", "e-bife")[0]!.elegidas).toEqual({ nalga: 1, chimi: 1 });
  });
});
