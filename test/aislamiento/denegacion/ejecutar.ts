import { vi } from "vitest";
import { prismaSinEmpresa } from "../../setup/test-db";
import { __cookiesDeTest, __limpiarCookiesDeTest, __setCookieDeTestParaEmpresa, __setCookieDeTestParaSucursal } from "../../setup/next-headers-stub";
import { baseDeEmpresa } from "../../../src/core/auth/base";
import { derivarArgumentos, unir, type Escenario, type Generadores, type Kit, type Planteo } from "./argumentos";
import { huellaDeLaBase, tablasCambiadas, type Mundo } from "./mundo";
import type { PuertaInventariada } from "./inventario-de-puertas";

/**
 * El EJECUTOR de la matriz de denegación por defecto (GT-3b): invoca una puerta en un escenario, mira qué pasó (qué devolvió o lanzó, si escribió algo en alguna tabla, si dejó una cookie) y devuelve los
 * PROBLEMAS (vacío = la puerta negó como debía). Cada archivo de test que lo usa declara antes `vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }))`.
 *
 * Qué cuenta como negar:
 *  - (a) anónimo y (b) sin empresa: la puerta LANZA (una redirección al login también) o devuelve `{ ok: false }`. Cualquier dato o `ok: true` es un problema.
 *  - (c) otra empresa y (d) otra sucursal de la misma empresa: lo que devuelva NO puede traer ni un solo marcador de lo ajeno (`ZZ-E2`, `ZZ-S2`), y una MUTACIÓN no puede terminar en `ok: true`.
 *  - propia (control positivo de las lecturas): con ids propios devuelve lo propio.
 *  - en todos: ninguna tabla cambia (la huella de toda la base, antes y después) y ninguna cookie se escribe.
 */
const MODULOS_DEL_SERVIDOR = import.meta.glob("../../../src/server/{actions,consultas,lecturas}/**/*.ts");

const MARCADOR_DE_CUALQUIER_COSA =/ZZ-(A1|E2|S2)/i;
const SOLO_OTRA_EMPRESA = /ZZ-E2/i;
const OTRA_EMPRESA_U_OTRA_SUCURSAL = /ZZ-(E2|S2)/i;

/**
 * Qué marcador cuenta como «ajeno» para una puerta. Siempre el de OTRA EMPRESA (`ZZ-E2`). El de OTRA SUCURSAL de la misma empresa (`ZZ-S2`) solo para lo que es de una sucursal (una puerta de contexto sucursal
 * o mixto, una consulta, una lectura): una lectura de CONTEXTO EMPRESA (la matriz de capacidades, la lista de roles) devuelve por diseño lo que la empresa tiene en todas sus sucursales, y el escenario (c)
 * —otra empresa— es el que prueba que no se sale de la empresa.
 */
function marcadorAjenoDe(puerta: PuertaInventariada): RegExp {
  return puerta.contexto === "empresa" ? SOLO_OTRA_EMPRESA : OTRA_EMPRESA_U_OTRA_SUCURSAL;
}

export interface Salida {
  lanzo: boolean;
  valor: unknown;
  /** El mensaje del error si lanzó. */
  error: string;
  /** El resultado serializado (o el mensaje del error). */
  texto: string;
}

export type Veredicto = "RECHAZA" | "VACIO" | "OK" | "DATOS";

function serializar(valor: unknown): string {
  return (
    JSON.stringify(valor, (_clave, v: unknown) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Map) return [...v.entries()];
      if (v instanceof Set) return [...v.values()];
      if (typeof v === "object" && v !== null && "toFixed" in v && "toString" in v) return String(v);
      return v;
    }) ?? "undefined"
  );
}

function estaVacio(valor: unknown): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === "number") return valor === 0;
  if (typeof valor === "boolean") return valor === false;
  if (typeof valor === "string") return valor === "";
  if (Array.isArray(valor)) return valor.length === 0;
  if (valor instanceof Map || valor instanceof Set) return valor.size === 0;
  if (typeof valor === "object") return Object.values(valor).every((v) => estaVacio(v));
  return false;
}

function veredictoDe(s: Salida): Veredicto {
  if (s.lanzo) return "RECHAZA";
  const v = s.valor as { ok?: unknown; resultados?: unknown } | null | undefined;
  // Un lote (`registrarConteosFisicos`) responde `ok: true` con "0 de N registrados" y el rechazo de cada fila: si todas se rechazaron, el lote negó.
  if (v && typeof v === "object" && v.ok === true && Array.isArray(v.resultados) && v.resultados.length > 0 && v.resultados.every((r) => (r as { ok?: unknown })?.ok === false)) return "RECHAZA";
  if (v && typeof v === "object" && "ok" in v) return v.ok === false ? "RECHAZA" : "OK";
  return estaVacio(s.valor) ? "VACIO" : "DATOS";
}

/** Los strings con marcador que aparecen en los argumentos (los ids que mandó el que llama): si la respuesta solo los repite, no es una fuga. */
function marcadoresDeEntrada(puerta: PuertaInventariada, argumentos: unknown[]): string[] {
  const hallados = new Set<string>();
  const visitar = (v: unknown, nivel: number): void => {
    if (nivel > 6) return;
    if (typeof v === "string") {
      if (MARCADOR_DE_CUALQUIER_COSA.test(v)) hallados.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => visitar(x, nivel + 1));
    else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach((x) => visitar(x, nivel + 1));
  };
  // El `db` (un cliente de Prisma, un `Proxy` enorme) no se recorre nunca: se lo reconoce por el nombre de su parámetro.
  argumentos.forEach((a, i) => {
    if (!["db", "tx"].includes(puerta.parametros[i]?.nombre ?? "")) visitar(a, 0);
  });
  return [...hallados].sort((a, b) => b.length - a.length);
}

const reloj = { ahora: 0 };

/** Congela la fecha del proceso y la hace avanzar 61 s por invocación: el cupo de mutaciones (300 por minuto) y el de lecturas (600) cuentan por usuario y la matriz invoca cientos de puertas con el mismo. */
export function prepararEntorno(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  reloj.ahora = Date.now();
  vi.setSystemTime(reloj.ahora);
}

export function soltarEntorno(): void {
  vi.useRealTimers();
}

async function ponerSesion(escenario: Escenario, mundo: Mundo, sucursalActivaId: string): Promise<void> {
  const { getUsuarioActual } = await import("../../../src/core/auth/session");
  __limpiarCookiesDeTest();
  if (escenario === "anonimo") {
    vi.mocked(getUsuarioActual).mockResolvedValue(null);
    return;
  }
  if (escenario === "sinEmpresa") {
    vi.mocked(getUsuarioActual).mockResolvedValue({ id: mundo.sinEmpresa.id, email: mundo.sinEmpresa.email, nombre: null });
    return;
  }
  vi.mocked(getUsuarioActual).mockResolvedValue({ id: mundo.u1.id, email: mundo.u1.email, nombre: null });
  __setCookieDeTestParaEmpresa(mundo.e1.empresaId);
  __setCookieDeTestParaSucursal(sucursalActivaId);
}

function kitsDelEscenario(escenario: Escenario, mundo: Mundo): { propio: Kit; ajeno: Kit } {
  const propio = unir(mundo.e1, mundo.s1);
  if (escenario === "ajenaEmpresa") return { propio, ajeno: unir(mundo.e2, mundo.d2) };
  if (escenario === "ajenaSucursal") return { propio, ajeno: unir(mundo.e1, mundo.s2) };
  return { propio, ajeno: propio };
}

/** El `db` de las consultas y lecturas: sin sesión ni empresa (a, b) la base del proceso SIN `app.empresa_id`; con sesión (c, d, propia) la de la empresa E1. */
function dbDelEscenario(escenario: Escenario, mundo: Mundo): unknown {
  return escenario === "anonimo" || escenario === "sinEmpresa" ? prismaSinEmpresa : baseDeEmpresa(mundo.e1.empresaId).db;
}

async function funcionDe(puerta: PuertaInventariada): Promise<(...args: unknown[]) => Promise<unknown>> {
  const cargador = MODULOS_DEL_SERVIDOR[`../../../src/server/${puerta.archivo}`];
  if (!cargador) throw new Error(`No se encontró el módulo de ${puerta.clave}`);
  const modulo = (await cargador()) as Record<string, unknown>;
  const f = modulo[puerta.nombre];
  if (typeof f !== "function") throw new Error(`${puerta.clave} no es una función exportada`);
  return f as (...args: unknown[]) => Promise<unknown>;
}

/** Qué se le pasaría a la puerta en el escenario con el mundo REAL, SIN ejecutarla. */
function plantear(puerta: PuertaInventariada, escenario: Escenario, mundo: Mundo, generadores: Generadores): Planteo {
  const { propio, ajeno } = kitsDelEscenario(escenario, mundo);
  const d = derivarArgumentos({ puerta, escenario, propio, ajeno, db: puerta.tipo === "accion" ? null : dbDelEscenario(escenario, mundo), mundo }, generadores);
  return { argumentos: d.argumentos, variantes: d.variantes, usados: d.usados, faltan: d.faltan };
}

export interface Resultado {
  planteo: Planteo;
  /** Qué pasó en cada llamada (una por variante). */
  salidas: Salida[];
  veredictos: Veredicto[];
  problemas: string[];
}

export interface OpcionesDeCorrida {
  /** Solo el escenario `propia`: la lectura devuelve un agregado sin ninguna fila identificable (el control positivo no puede buscar el marcador propio). */
  sinMarcaPropia?: boolean;
  /** La puerta está declarada en `RECHAZOS_CRUDOS_DE_LA_BASE`: en los escenarios ajenos se espera (y se exige) una excepción cruda de la base. */
  rechazoCrudoDeLaBase?: boolean;
  /** La puerta está en `OK_SIN_EFECTO_POR_DISENO` para este escenario: un `ok: true` sin escritura y sin filas ajenas no es un problema. */
  okSinEfectoPorDiseno?: boolean;
  /** La puerta necesita estar parada en la sucursal VACÍA (S4) para que la precondición de su destino no tape el chequeo del origen (las copias entre sucursales solo se hacen sobre un destino vacío). */
  enLaSucursalVacia?: boolean;
}

/** Invoca la puerta en el escenario (una vez por variante de argumentos) y devuelve qué pasó y qué problemas tiene. Una MUTACIÓN con ids ajenos que termina en `ok: true` es un problema; una lectura solo si trae filas ajenas. */
export async function correrPuerta(puerta: PuertaInventariada, escenario: Escenario, mundo: Mundo, generadores: Generadores, opciones: OpcionesDeCorrida = {}): Promise<Resultado> {
  const planteo = plantear(puerta, escenario, mundo, generadores);
  if (!planteo.argumentos) throw new Error(`${puerta.clave}: no se pudieron derivar los argumentos (${planteo.faltan.join(", ")})`);
  const f = await funcionDe(puerta);
  const salidas: Salida[] = [];
  const veredictos: Veredicto[] = [];
  const problemas: string[] = [];
  const crudos: number[] = [];

  for (const [i, argumentos] of planteo.variantes.entries()) {
    const etiqueta = planteo.variantes.length > 1 ? `[llamada ${i + 1} de ${planteo.variantes.length}] ` : "";
    await ponerSesion(escenario, mundo, opciones.enLaSucursalVacia ? mundo.s4Id : mundo.s1.sucursalId);
    reloj.ahora += 61_000;
    vi.setSystemTime(reloj.ahora);

    const antes = await huellaDeLaBase();
    let salida: Salida;
    try {
      const valor = await f(...argumentos);
      salida = { lanzo: false, valor, error: "", texto: serializar(valor) };
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      const mensaje = e instanceof Error ? `${e.name}${codigo ? `[${codigo}]` : ""}: ${e.message.replace(/\s+/g, " ").slice(-400)}${(e as { digest?: string }).digest ? ` [${(e as { digest?: string }).digest}]` : ""}` : String(e);
      salida = { lanzo: true, valor: undefined, error: mensaje, texto: mensaje };
    }
    const despues = await huellaDeLaBase();
    const tablasEscritas = tablasCambiadas(antes, despues);
    const cookiesEscritas = [...__cookiesDeTest().escritas.keys(), ...__cookiesDeTest().borradas];
    const veredicto = veredictoDe(salida);
    salidas.push(salida);
    veredictos.push(veredicto);

    const reflejo = marcadoresDeEntrada(puerta, argumentos);
    const sinReflejo = reflejo.reduce((t, m) => t.split(m).join("·"), salida.texto);
    const mal = (texto: string) => problemas.push(`${etiqueta}${texto}`);
    if (tablasEscritas.length) mal(`escribió en ${tablasEscritas.join(", ")}`);
    if (cookiesEscritas.length) mal(`dejó cookies: ${cookiesEscritas.join(", ")}`);
    if (escenario === "anonimo" || escenario === "sinEmpresa") {
      // Una acción tiene su propia sesión que negar. Una consulta o lectura no tiene sesión: recibe el `db` (sin empresa en estos escenarios, así que la RLS no deja ninguna fila) y puede devolver una forma vacía
      // (`{ cartaVacia: true, secciones: [] }`); lo que no puede es traer filas de nadie, y eso lo dice el marcador de abajo.
      if (puerta.tipo === "accion" && (veredicto === "OK" || veredicto === "DATOS")) mal(`sin ${escenario === "anonimo" ? "sesión" : "empresa"} devolvió ${veredicto === "OK" ? "ok: true" : "datos"}: ${salida.texto.slice(0, 160)}`);
      if (MARCADOR_DE_CUALQUIER_COSA.test(sinReflejo)) mal(`filtró filas de las empresas: ${hallazgos(sinReflejo)}`);
    } else if (escenario === "propia") {
      // Control POSITIVO de una lectura: con ids propios y la sesión de u1 tiene que devolver lo propio. Si no, la prueba de «no filtra lo ajeno» no probaría nada (una lectura que cayó al cliente sin empresa
      // —`prisma` en vez de `ctx.db`— devuelve vacío, y vacío también pasa como «no filtró»).
      if (marcadorAjenoDe(puerta).test(sinReflejo)) mal(`filtró filas ajenas: ${hallazgos(sinReflejo)}`);
      if (salida.lanzo) mal(`la lectura PROPIA lanzó: ${salida.error.slice(0, 200)}`);
      // Las lecturas de `server/lecturas` son ayudantes internos (booleanos, números, ids): se ejercen a través de las acciones y consultas que las usan, cuyo control positivo sí exige lo propio.
      else if (puerta.tipo !== "lectura" && !opciones.sinMarcaPropia && !/ZZ-A1/i.test(sinReflejo)) mal(`la lectura PROPIA no devolvió nada propio (veredicto ${veredicto}): ${salida.texto.slice(0, 160)}`);
    } else {
      if (marcadorAjenoDe(puerta).test(sinReflejo)) mal(`filtró filas ajenas: ${hallazgos(sinReflejo)}`);
      if (puerta.mutacion && veredicto === "OK" && !opciones.okSinEfectoPorDiseno) mal(`con ids ajenos terminó en ok: true (${salida.texto.slice(0, 160)})`);
      if (salida.lanzo && /^PrismaClientKnownRequestError\[P2003\]/.test(salida.error)) crudos.push(i);
      // Cualquier OTRA excepción de Prisma (un privilegio que le falta al rol de la base de pruebas, un registro que no existe) no es un rechazo de pertenencia: taparía un verde que no prueba nada.
      else if (salida.lanzo && /^PrismaClient/.test(salida.error)) mal(`lanzó una excepción de Prisma que no es una clave foránea (${salida.error.slice(0, 160)}): no es un rechazo de pertenencia`);
    }
  }
  // Un rechazo crudo de la base (clave foránea) no cruza nada, pero no es tipado: tiene que estar declarado, y la declaración tiene que seguir siendo cierta.
  if (crudos.length && !opciones.rechazoCrudoDeLaBase) problemas.push(`rechazó con una excepción cruda de Prisma (la clave foránea de la base) en lugar de ok: false: declarala en RECHAZOS_CRUDOS_DE_LA_BASE o validá el id (${crudos.length} llamada(s))`);
  if (!crudos.length && opciones.rechazoCrudoDeLaBase && (escenario === "ajenaEmpresa" || escenario === "ajenaSucursal")) problemas.push("ya no rechaza con una excepción cruda de la base: sacala de RECHAZOS_CRUDOS_DE_LA_BASE");
  return { planteo, salidas, veredictos, problemas };
}

function hallazgos(texto: string): string {
  const encontrados = new Set(texto.match(/[\w-]*ZZ-(?:E2|S2|A1)[\w-]*/gi) ?? []);
  return [...encontrados].slice(0, 5).join(", ");
}
