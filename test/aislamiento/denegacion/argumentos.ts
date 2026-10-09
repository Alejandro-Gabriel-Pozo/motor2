import { CAMPOS_DE_SUCURSAL, type KitDeEmpresa, type KitDeSucursal, type Mundo } from "./mundo";
import type { ParametroDePuerta, PuertaInventariada } from "./inventario-de-puertas";

/**
 * Los ARGUMENTOS con que cada escenario invoca cada puerta (GT-3b). Se derivan por NOMBRE de parámetro (las convenciones del repo son estables: `productoId`, `mesaId`, `sucursalId`…) y lo que no
 * se puede derivar se escribe a mano en `generadores.ts` (`ARGUMENTOS_A_MEDIDA` para el arreglo entero, `PARAMETROS_A_MEDIDA` para un parámetro ambiguo). Lo que no se puede generar en absoluto va a
 * `SIN_GENERADOR` con motivo (lista cerrada que solo se achica).
 *
 * Qué es «ajeno» depende del escenario:
 *  - `ajenaEmpresa` (c): TODO id del kit sale de la empresa E2 (u1 no pertenece a ella).
 *  - `ajenaSucursal` (d): solo los ids de UNA sucursal (S2, o su vecina) son ajenos; el catálogo, las recetas centrales, etc. son de E1 y u1 los puede usar.
 *  - `anonimo` y `sinEmpresa` (a, b): ids PROPIOS y válidos de S1 (el mejor caso de quien se hace pasar por un usuario).
 *
 * En las consultas y lecturas (que reciben el contexto ya resuelto: `db`, la sucursal activa, la empresa, el usuario), esos parámetros de CONTEXTO se llenan con lo PROPIO de u1 aunque el escenario sea
 * uno de los ajenos: lo que viene del cliente son los demás ids, y esos sí son ajenos. En las acciones —que son el endpoint—, todo parámetro es del cliente, incluida la sucursal.
 */
export type Escenario = "anonimo" | "sinEmpresa" | "ajenaEmpresa" | "ajenaSucursal" | "propia";

/** El kit completo: lo de empresa y lo de sucursal juntos (`marca` es el de la sucursal). */
export type Kit = KitDeEmpresa & KitDeSucursal;

export interface ContextoDeArgumentos {
  puerta: PuertaInventariada;
  escenario: Escenario;
  /** Lo propio de u1: la empresa E1 y la sucursal S1. */
  propio: Kit;
  /** Lo ajeno del escenario (para los escenarios (a) y (b), lo propio mismo). */
  ajeno: Kit;
  /** Marca los ids AJENOS que se leen (para saber si el escenario tiene algo que probar). */
  usados: Set<string>;
  /** El `db` que reciben las consultas y lecturas (`null` en las acciones). */
  db: unknown;
  mundo: Mundo;
}

export type Valor = (k: Kit, c: ContextoDeArgumentos) => unknown;

/** Los parámetros de CONTEXTO de una consulta o lectura: salen del pedido (la sucursal activa, la empresa, el usuario, la hora), nunca del cliente. */
const CONTEXTO_DE_CONSULTA: Readonly<Record<string, Valor>> = {
  db: (_k, c) => c.db,
  tx: (_k, c) => c.db,
  empresaId: (_k, c) => c.propio.empresaId,
  sucursalId: (_k, c) => c.propio.sucursalId,
  excluirSucursalId: (_k, c) => c.propio.sucursalId,
  sucursalIds: (_k, c) => [c.propio.sucursalId],
  sucursales: (_k, c) => [{ id: c.propio.sucursalId, nombre: "Central ZZ-A1" }],
  usuarioId: (_k, c) => c.mundo.u1.id,
  ahora: () => new Date(),
  hoy: () => new Date(),
  zonaHoraria: () => "America/Argentina/Buenos_Aires",
};

/** Los ids que llegan del cliente, por nombre de parámetro → campo del kit. */
const IDS: Readonly<Record<string, (k: Kit) => unknown>> = {
  empresaId: (k) => k.empresaId,
  sucursalId: (k) => k.sucursalId,
  sucursalOrigenId: (k) => k.sucursalId,
  sucursalDestinoId: (k) => k.vecinaId,
  usuarioId: (k) => k.miembroId,
  usuarioDestinoId: (k) => k.miembroId,
  membresiaId: (k) => k.membresiaId,
  invitacionId: (k) => k.invitacionId,
  productoId: (k) => k.productoId,
  productoIds: (k) => [k.productoId, k.productoMp2Id],
  insumoProductoId: (k) => k.productoId,
  insumoId: (k) => k.insumoId,
  grupoId: (k) => k.grupoId,
  grupoPadreId: (k) => k.grupoId,
  categoriaId: (k) => k.categoriaId,
  unidadId: (k) => k.unidadId,
  unidadStockId: (k) => k.unidadId,
  unidadCompraId: (k) => k.unidad2Id,
  presentacionId: (k) => k.presentacionId,
  proveedorId: (k) => k.proveedorId,
  clienteId: (k) => k.clienteId,
  rolId: (k) => k.rolId,
  motivoId: (k) => k.motivoId,
  destinoId: (k) => k.destinoId,
  seccionId: (k) => k.seccionId,
  seccionOrigenId: (k) => k.seccionId,
  seccionDestinoId: (k) => k.seccionVecinaId,
  seccionCartaId: (k) => k.seccionCartaId,
  promoCartaId: (k) => k.promoCartaId,
  generoCartaId: (k) => k.generoCartaId,
  itemAgrupadoCartaId: (k) => k.itemAgrupadoCartaId,
  opcionId: (k) => k.opcionId,
  recetaIngredienteId: (k) => k.recetaIngredienteId,
  mesaId: (k) => k.mesaId,
  cuentaId: (k) => k.cuentaId,
  cuentaItemId: (k) => k.cuentaItemId,
  promoCuentaId: (k) => k.promoCuentaId,
  itemIds: (k) => [k.cuentaItemId],
  operacionId: (k) => k.compraId,
  idOperacion: (k) => k.compraId,
  conteoId: (k) => k.conteoId,
  insumoOrigenId: (k) => k.insumoId,
  insumoDestinoId: (k) => k.insumoId,
  padreNuevoId: (k) => k.grupoId,
  productoIdExcluir: (k) => k.productoId,
};

/** Valores NO ids, por nombre de parámetro: lo que haga falta para que la forma sea válida y la llamada llegue a la lógica. */
const VALORES: Readonly<Record<string, Valor>> = {
  activo: () => false,
  activa: () => false,
  disponible: () => false,
  habilitado: () => false,
  aplicar: () => true,
  visibleEnCarta: () => true,
  sirveDeRespaldoEnVentas: () => false,
  habilitadaVista: () => true,
  confirmado: () => true,
  confirmarFusion: () => true,
  soloActivos: () => false,
  nombre: () => "Nombre nuevo",
  nombreNuevo: () => "Nombre nuevo",
  descripcion: () => "descripción de prueba",
  motivo: () => "motivo de prueba",
  notas: () => "notas de prueba",
  termino: () => "ZZ",
  email: () => "nuevo@ajeno.test",
  emailConfirmado: () => "confirmado@ajeno.test",
  slug: () => "slug-nuevo",
  cantidad: () => 1,
  importe: () => 1,
  precio: () => 1,
  precioLocal: () => 1,
  minimo: () => 1,
  numero: () => 99,
  comensales: () => 2,
  orden: () => 1,
  limite: () => 5,
  decimales: () => 2,
  x: () => 10,
  y: () => 10,
  versionVista: () => 1,
  versionEsperada: () => 1,
  frecuenciaDias: () => 7,
  porcentaje: () => 10,
  descuentoPorcentaje: () => 10,
  restanteVisto: () => 1,
  diasAtras: () => 30,
  dias: () => 30,
  fecha: () => new Date(),
  desde: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  hasta: () => new Date(),
  desdeIn: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  hastaIn: () => new Date(),
  loteVencimiento: () => null,
  factorConversion: () => 2,
  desdeParam: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  hastaParam: () => new Date(),
  cuit: () => "20-12345678-9",
  precioGlobal: () => 1000,
  requerido: () => 1,
  cantidadNecesaria: () => 1,
  rolDeLaMembresia: () => null,
  que: () => ({}),
  cursor: () => undefined,
  cursorHistorial: () => undefined,
  pantallaActual: () => undefined,
  volver: () => undefined,
};

/** Un parámetro que se puede llenar sin un generador a medida. `undefined` en el retorno = no se pudo (y no es opcional). */
function valorDe(p: ParametroDePuerta, k: Kit, c: ContextoDeArgumentos, aMedida: Readonly<Record<string, Valor>> | undefined): { ok: true; valor: unknown } | { ok: false } {
  if (aMedida && Object.hasOwn(aMedida, p.nombre)) return { ok: true, valor: aMedida[p.nombre](k, c) };
  if (c.puerta.tipo !== "accion" && Object.hasOwn(CONTEXTO_DE_CONSULTA, p.nombre)) return { ok: true, valor: CONTEXTO_DE_CONSULTA[p.nombre](k, c) };
  if (Object.hasOwn(IDS, p.nombre)) return { ok: true, valor: IDS[p.nombre](k) };
  if (Object.hasOwn(VALORES, p.nombre)) return { ok: true, valor: VALORES[p.nombre](k, c) };
  if (p.opcional) return { ok: true, valor: undefined };
  // Un mapa libre de valores (`Readonly<Record<string, unknown>>`: el tema o el portal de la carta): vacío es una forma válida y no lleva ids.
  if (/^Readonly<Record<string, unknown>>$/.test(p.tipo)) return { ok: true, valor: {} };
  return { ok: false };
}

/** El kit con el que se llena: un `Proxy` que anota cada campo AJENO que se lee. */
function kitObservado(c: Omit<ContextoDeArgumentos, "usados">, usados: Set<string>): Kit {
  const ajenoSiempre = c.escenario === "ajenaEmpresa";
  const ajenoSoloSucursal = c.escenario === "ajenaSucursal";
  return new Proxy(c.ajeno, {
    get(objetivo, campo, receptor) {
      // `marca` no es un id: es el texto que se pega a los nombres para reconocer de dónde salió una fila.
      if (typeof campo === "string" && campo !== "marca") {
        if (ajenoSiempre || (ajenoSoloSucursal && CAMPOS_DE_SUCURSAL.has(campo))) usados.add(campo);
      }
      return Reflect.get(objetivo, campo, receptor);
    },
  });
}

/**
 * Varias llamadas a la misma puerta en el mismo escenario: un generador devuelve `variantes([...], [...])` cuando una sola llamada no alcanza a probar todos los ids ajenos que recibe (una edición por
 * id ajeno y un alta con referencias ajenas son dos caminos distintos de la misma acción: si el primero rechaza antes, el segundo nunca se ejerce).
 */
export class Variantes {
  constructor(readonly lista: readonly unknown[][]) {}
}
export const variantes = (...lista: unknown[][]): Variantes => new Variantes(lista);

/** ¿El campo del kit es AJENO en este escenario? En el de otra empresa todo lo es; en el de otra sucursal solo lo que vive en una sucursal (el catálogo y la carta central son de E1 y u1 los puede usar). */
function esAjeno(c: Pick<ContextoDeArgumentos, "escenario">, campo: string): boolean {
  return c.escenario === "ajenaEmpresa" || (c.escenario === "ajenaSucursal" && CAMPOS_DE_SUCURSAL.has(campo));
}

/**
 * Una variante de argumentos que SOLO se ejerce si lleva al menos uno de los `campos` ajenos en este escenario: con ids propios y válidos la llamada escribiría de verdad. En los escenarios sin ids ajenos
 * (anónimo, sin empresa, propia) la variante siempre existe (y `derivarArgumentos` se queda con la primera), para que la puerta se invoque.
 */
export function intento(c: Pick<ContextoDeArgumentos, "escenario">, campos: readonly string[], argumentos: unknown[]): unknown[] | false {
  const conIdsAjenos = c.escenario === "ajenaEmpresa" || c.escenario === "ajenaSucursal";
  return !conIdsAjenos || campos.some((campo) => esAjeno(c, campo)) ? argumentos : false;
}

export interface Derivacion {
  /** `null` si algún parámetro obligatorio no se pudo llenar. */
  argumentos: unknown[] | null;
  /** Todas las llamadas del escenario (una sola salvo que el generador devuelva `variantes`). */
  variantes: unknown[][];
  /** Los ids ajenos que se usaron: vacío = el escenario no tiene nada que probar para esta puerta. */
  usados: string[];
  /** Los parámetros que no se pudieron llenar. */
  faltan: string[];
}

export interface Generadores {
  /** El arreglo entero de argumentos (o `variantes(...)`), para las puertas con objetos de entrada. */
  completos: Readonly<Record<string, Valor>>;
  /** Un parámetro ambiguo de una puerta (`id`, `operacionId`…). */
  parametros: Readonly<Record<string, Readonly<Record<string, Valor>>>>;
  /** Un parámetro que significa lo mismo en todo un archivo (en las recetas, `productoId` es siempre el producto CON receta, un PV). `parametros` de la puerta manda sobre esto. */
  porArchivo: Readonly<Record<string, Readonly<Record<string, Valor>>>>;
}

export function derivarArgumentos(base: Omit<ContextoDeArgumentos, "usados">, g: Generadores): Derivacion {
  const usados = new Set<string>();
  const ctx: ContextoDeArgumentos = { ...base, usados };
  const kit = kitObservado(base, usados);
  const completo = Object.hasOwn(g.completos, base.puerta.clave) ? g.completos[base.puerta.clave] : undefined;
  if (completo) {
    const r = completo(kit, ctx);
    let lista = r instanceof Variantes ? r.lista.map((v) => [...v]) : [r as unknown[]];
    // Sin ids ajenos (anónimo, sin empresa, propia) todas las variantes son lo mismo: una alcanza.
    if (base.escenario !== "ajenaEmpresa" && base.escenario !== "ajenaSucursal") lista = lista.slice(0, 1);
    return { argumentos: lista[0] ?? null, variantes: lista, usados: [...usados], faltan: [] };
  }
  const aMedida = { ...(Object.hasOwn(g.porArchivo, base.puerta.archivo) ? g.porArchivo[base.puerta.archivo] : {}), ...(Object.hasOwn(g.parametros, base.puerta.clave) ? g.parametros[base.puerta.clave] : {}) };
  const argumentos: unknown[] = [];
  const faltan: string[] = [];
  for (const p of base.puerta.parametros) {
    const r = valorDe(p, kit, ctx, aMedida);
    if (r.ok) argumentos.push(r.valor);
    else {
      faltan.push(`${p.nombre}: ${p.tipo}`);
      argumentos.push(undefined);
    }
  }
  return { argumentos: faltan.length ? null : argumentos, variantes: faltan.length ? [] : [argumentos], usados: [...usados], faltan };
}

/** Un mundo de mentira para derivar argumentos sin base: cada campo vale su propio nombre. Sirve para la cobertura estática. */
function mundoFicticio(): Mundo {
  const kit = (marca: string) => new Proxy({ marca } as Record<string, unknown>, { get: (o, k) => (typeof k === "string" ? (k in o ? o[k] : `${marca}:${k}`) : undefined) });
  return {
    e1: kit("ZZ-A1") as unknown as KitDeEmpresa,
    e2: kit("ZZ-E2") as unknown as KitDeEmpresa,
    s1: kit("ZZ-A1") as unknown as KitDeSucursal,
    s2: kit("ZZ-S2") as unknown as KitDeSucursal,
    d2: kit("ZZ-E2") as unknown as KitDeSucursal,
    u1: { id: "u1", email: "u1@e1.test" },
    s4Id: "s4",
    sinEmpresa: { id: "sin-empresa", email: "sin-empresa@dominio.test" },
    rolAdminE1Id: "rol-admin",
    rolOperadorE1Id: "rol-operador",
  };
}

export interface Planteo {
  /** Los argumentos de la primera llamada; `null` si algún parámetro obligatorio no se pudo llenar. */
  argumentos: unknown[] | null;
  /** Todas las llamadas del escenario. */
  variantes: unknown[][];
  usados: string[];
  faltan: string[];
}

/** Qué se le pasaría a la puerta en el escenario, SIN ejecutarla ni tocar la base (con el mundo ficticio): sirve para la cobertura estática y para decidir qué casos registrar. */
export function planteoEstatico(puerta: PuertaInventariada, escenario: Escenario, generadores: Generadores): Planteo {
  const mundo = mundoFicticio();
  const propio = unir(mundo.e1, mundo.s1);
  const ajeno = escenario === "ajenaEmpresa" ? unir(mundo.e2, mundo.d2) : escenario === "ajenaSucursal" ? unir(mundo.e1, mundo.s2) : propio;
  const d = derivarArgumentos({ puerta, escenario, propio, ajeno, db: null, mundo }, generadores);
  return { argumentos: d.argumentos, variantes: d.variantes, usados: d.usados, faltan: d.faltan };
}

/** Une los dos kits (empresa + sucursal) en uno. */
export function unir(e: KitDeEmpresa, s: KitDeSucursal): Kit {
  return new Proxy({} as Kit, {
    get: (_o, campo) => (typeof campo === "string" ? ((s as unknown as Record<string, unknown>)[campo] ?? (e as unknown as Record<string, unknown>)[campo]) : undefined),
    has: (_o, campo) => typeof campo === "string" && (campo in (s as object) || campo in (e as object)),
    ownKeys: () => [...new Set([...Reflect.ownKeys(e), ...Reflect.ownKeys(s)])],
    getOwnPropertyDescriptor: (_o, campo) => ({ enumerable: true, configurable: true, value: (s as unknown as Record<string, unknown>)[campo as string] ?? (e as unknown as Record<string, unknown>)[campo as string] }),
  });
}

