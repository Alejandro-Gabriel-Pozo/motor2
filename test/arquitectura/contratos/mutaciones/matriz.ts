import { ARCHIVO_DE_AREAS } from "../gobernanza/areas";
import { MOTIVO_MINIMO, RESPONSABLES, esFechaValida, evaluarVencimientos, referenciaValida } from "../politica";
import type { Deuda, Contrato } from "../tipos";
import { ARCHIVO_DEL_MANIFIESTO, archivosDelAlcance, elegirConsumidor, elegirTokenUsado, hallazgoDeEntrada, primerUsoDelArea, rutaNuevaEnElAlcance, type BaseDeMutacion, type EjemplosDeContrato, type Verifica } from "./operadores";

/**
 * La MATRIZ de invariantes del guardián de contratos (paso G6a): «invariante × elementos que lo definen, lo aplican y lo verifican × mutaciones que demuestran su protección».
 * La unidad es el INVARIANTE (algo que tiene que ser verdad siempre), no cada símbolo del repo. Cada invariante declara:
 *  - `elementos`: lo que lo DEFINE (la fuente, la marca, la regla), lo que lo APLICA (los consumidores, el manifiesto, la declaración de áreas) y lo que lo VERIFICA (el motor, los tests);
 *  - `mutaciones`: por cada CLASE de mutación aplicable, al menos una forma concreta de romperlo (un operador de `operadores.ts` con sus parámetros) y el hallazgo que el guardián tiene que
 *    dar —tipo, archivo, línea real y un fragmento del mensaje—; o, si una clase no aplica, `noAplica` con el motivo (20 caracteres o más).
 * Si una mutación SOBREVIVE (la verificación pasa, o da otro hallazgo), el arnés (`arnes.ts`) falla con «HUECO: invariante X · clase Y · elemento Z: el guardián no protege esto».
 * Los invariantes de los contratos se DERIVAN del manifiesto (un contrato nuevo entra solo, con las mutaciones estándar); los del guardián se escriben acá.
 */

export const CLASES_DE_MUTACION = ["eliminacion", "alteracion", "duplicacion", "desconexion", "exclusion-del-analisis", "evasion"] as const;
export type ClaseDeMutacion = (typeof CLASES_DE_MUTACION)[number];

/** Un elemento concreto del repo: su ruta y qué es (una función, una declaración, un contrato, un manifiesto, una marca, una constante, una configuración, un control). */
export interface ElementoDeMatriz {
  ruta: string;
  que: string;
}

/**
 * Lo que la verificación tiene que dar. `linea`: `"calculada"` = la línea sale de la mutación (el operador la calcula sobre el árbol mutado y el hallazgo real tiene que coincidir);
 * `"sin-posicion"` = el hallazgo es de gobierno (no apunta a un lugar del código) y va en la línea 1; un número = esa línea fija.
 */
export interface EsperadoDeMutacion {
  verifica: Verifica | "ninguno";
  tipo: string;
  archivo: string;
  linea: number | "calculada" | "sin-posicion";
  /** Un fragmento del diagnóstico («qué falta → cómo se corrige»): prueba que el mensaje es útil y trae el id del contrato o la causa. */
  mensajeIncluye: string;
}

/**
 * `protegido`: la mutación tiene que dar `esperado`. `hueco-conocido`: HOY nada la detecta (el mecanismo que la detectaría es un paso siguiente, G6/G7); el arnés comprueba que
 * SIGUE sin detectarse y exige una entrada de deuda (`DEUDA_DE_HUECOS`) con el mismo `hueco`; `esperado` dice lo que el mecanismo futuro tendría que decir.
 */
export type EstadoDeMutacion = "protegido" | "hueco-conocido";

export interface MutacionDeMatriz {
  id: string;
  clase: ClaseDeMutacion;
  /** El elemento que se muta. */
  elemento: ElementoDeMatriz;
  operador: string;
  parametros: Readonly<Record<string, string>>;
  esperado: EsperadoDeMutacion;
  estado: EstadoDeMutacion;
  /** El id del hueco en `DEUDA_DE_HUECOS` (cadena vacía si está protegido). */
  hueco: string;
}

export interface NoAplicaDeClase {
  clase: ClaseDeMutacion;
  motivo: string;
}

export interface Invariante {
  id: string;
  descripcion: string;
  origen: "contrato" | "guardian";
  /** Quién lo hace cumplir: el motor de contratos, las áreas, la clasificación, la política de plazos, las pruebas del propio guardián. */
  mecanismo: readonly string[];
  elementos: { definen: readonly ElementoDeMatriz[]; aplican: readonly ElementoDeMatriz[]; verifican: readonly ElementoDeMatriz[] };
  mutaciones: readonly MutacionDeMatriz[];
  noAplica: readonly NoAplicaDeClase[];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Datos de la matriz
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Los ejemplos que el autor de cada contrato da para que el arnés invente un USO crudo y una REDEFINICIÓN dentro del alcance. Un contrato nuevo del manifiesto sin su entrada acá hace
 * fallar el meta-test («actualizá la matriz»). El arnés comprueba que cada ejemplo dispara de verdad un detector del contrato.
 */
export const EJEMPLOS_DE_CONTRATOS: Readonly<Record<string, EjemplosDeContrato>> = {
  "separador-de-lista-de-carta": {
    uso: 'export const ZzUso = () => <ul className="flex divide-y"><li>x</li></ul>;\n',
    definicion: 'export const ZzDefinicion = () => <ul className="carta-divisor divide-y divide-[#e7e5e4]"><li>x</li></ul>;\n',
  },
  "borde-propio-de-carta": {
    uso: 'export const ZzUso = () => <div className="mt-2 border-t">x</div>;\n',
    definicion: 'export const ZzDefinicion = () => <li className="carta-borde border-b border-[#e7e5e4]">x</li>;\n',
  },
  // El uso crudo es un token mal escrito en una clase (un TSX); la redefinición, un token escrito fuera de `@theme static` (un CSS): cada ejemplo va en su propio tipo de archivo.
  "tokens-visuales": {
    uso: 'export const ZzUso = () => <p className="text-tinta-sueve">x</p>;\n',
    definicion: ".zz-definicion {\n  --color-tinta: red;\n}\n",
    extensiones: { uso: ".tsx", definicion: ".css" },
  },
};

/**
 * Los tipos de hallazgo que ninguna mutación del arnés puede producir y que cubre un test de `motor.test.ts`, `clasificacion.test.ts` o `areas.test.ts`: tipo → el título EXACTO del
 * test (el meta-test verifica que existe). Hoy cada tipo tiene una mutación, así que está vacío a propósito.
 */
export const CUBIERTOS_EN_MOTOR_TEST: Readonly<Record<string, { archivo: string; titulo: string }>> = {};

/** Un hueco conocido y su deuda: la misma forma y el mismo gobierno que la deuda del motor (`Deuda`), con el id del hueco como `fragmento`. */
export type DeudaDeHueco = Deuda;

const GOBIERNO_DE_HUECOS = {
  responsable: "dueño",
  aprobacion: { por: "dueño", referencia: "DEC-02" },
  creada: "2026-10-21",
  renovaciones: [],
  vence: "2026-12-20",
  resuelveEn: "G6",
} as const;

/**
 * DEUDA de los huecos conocidos: cosas que un intento de neutralizar el guardián puede hacer HOY sin que nada falle. El mecanismo que las detecta (el «guardián del guardián» y la
 * revisión del CI) es el paso G6/G7. Una entrada por hueco, con motivo, responsable, aprobación, fecha de creación y vencimiento a 60 días como máximo (la política de `politica.ts`,
 * evaluada con las mismas funciones que usa el motor); vencida, sin hueco que la use, o un hueco sin su entrada: el meta-test falla.
 */
export const DEUDA_DE_HUECOS: readonly DeudaDeHueco[] = [
  {
    archivo: "test/arquitectura/contratos/contratos.test.ts",
    fragmento: "evasion/test-desactivado",
    motivo: "un it.skip, describe.skip o .only en el test del guardián lo apaga y nada lo detecta todavía: falta el guardián del guardián",
    ...GOBIERNO_DE_HUECOS,
  },
  {
    archivo: "vitest.config.ts",
    fragmento: "evasion/test-excluido-en-vitest",
    motivo: "agregar el test del guardián al exclude de vitest.config.ts lo deja fuera de npm test sin que nada falle todavía",
    ...GOBIERNO_DE_HUECOS,
  },
  {
    archivo: "test/arquitectura/contratos/contratos.test.ts",
    fragmento: "evasion/test-renombrado-a-ts",
    motivo: "renombrar el test del guardián a un .ts que no termina en .test.ts lo saca de la corrida y la clasificación lo sigue aceptando",
    ...GOBIERNO_DE_HUECOS,
  },
  {
    archivo: ".github/workflows/ci.yml",
    fragmento: "desconexion/ci-sin-paso",
    motivo: "quitar o reemplazar el paso npm test del workflow de CI desconecta al guardián del Gate y nada revisa el CI todavía",
    ...GOBIERNO_DE_HUECOS,
  },
  {
    archivo: ".github/workflows/ci.yml",
    fragmento: "desconexion/ci-continue-on-error",
    motivo: "poner continue-on-error en el paso de tests del CI deja que el guardián falle sin romper el Gate y nada lo revisa todavía",
    ...GOBIERNO_DE_HUECOS,
  },
  {
    archivo: "package.json",
    fragmento: "desconexion/script-quitado",
    motivo: "quitar el script test de package.json desconecta al guardián de npm test y nada revisa los scripts todavía",
    ...GOBIERNO_DE_HUECOS,
  },
  {
    archivo: "test/arquitectura/contratos/motor.ts",
    fragmento: "evasion/caso-legitimo-silencia-un-uso",
    motivo: "un caso legítimo nuevo en la definición de un contrato silencia un uso crudo sin aprobación ni vencimiento: falta el hash aprobado de la definición",
    ...GOBIERNO_DE_HUECOS,
  },
];

/**
 * Lo que está mal en la deuda de un hueco (lista vacía = en regla): las mismas reglas del motor para una deuda —motivo, responsable de la lista cerrada, aprobación con
 * referencia válida, fechas reales, plazo de 60 días desde `creada`, no vencida— más el «dónde se resuelve» (G6). `hoy` es el reloj real en el guardián.
 */
export function problemasDeLaDeuda(d: DeudaDeHueco, hoy: string): string[] {
  const problemas: string[] = [];
  const en = `la deuda del hueco «${d.fragmento}»`;
  if (d.motivo.trim().length < MOTIVO_MINIMO) problemas.push(`${en} no tiene motivo (${MOTIVO_MINIMO} caracteres o más)`);
  if (!d.resuelveEn.includes("G6")) problemas.push(`${en} no dice que se resuelve en G6`);
  if (!RESPONSABLES.includes(d.responsable)) problemas.push(`${en} tiene un responsable fuera de la lista cerrada («${d.responsable}»)`);
  if (!d.aprobacion.por.trim() || !referenciaValida(d.aprobacion.referencia)) problemas.push(`${en} no tiene una aprobación válida`);
  if (!esFechaValida(d.creada) || !esFechaValida(d.vence)) return [...problemas, `${en} tiene una fecha que no es AAAA-MM-DD válida`];
  const inicio = d.renovaciones.reduce((ultima, r) => (r.fecha > ultima ? r.fecha : ultima), d.creada);
  const v = evaluarVencimientos([{ clase: "deuda", archivo: d.archivo, fragmento: d.fragmento, inicio, vence: d.vence }], hoy);
  if (v.vencidas.length > 0) problemas.push(`${en} venció el ${d.vence} (hoy es ${hoy}): resolvé el hueco (G6) o renová la deuda con motivo y aprobación`);
  if (v.excedidas.length > 0) problemas.push(`${en} vence a más de 60 días de su inicio o su inicio es posterior a hoy`);
  return problemas;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Constructores
// ---------------------------------------------------------------------------------------------------------------------------------

type Parametros = Readonly<Record<string, string>>;

function mut(
  invariante: string,
  clase: ClaseDeMutacion,
  operador: string,
  parametros: Parametros,
  elemento: ElementoDeMatriz,
  esperado: EsperadoDeMutacion,
  hueco = ""
): MutacionDeMatriz {
  const clave = Object.values(parametros).join("+");
  return { id: `${invariante}/${clase}/${operador}${clave ? `[${clave}]` : ""}`, clase, elemento, operador, parametros, esperado, estado: hueco === "" ? "protegido" : "hueco-conocido", hueco };
}

const esp = (verifica: EsperadoDeMutacion["verifica"], tipo: string, archivo: string, linea: EsperadoDeMutacion["linea"], mensajeIncluye: string): EsperadoDeMutacion => ({ verifica, tipo, archivo, linea, mensajeIncluye });
const el = (ruta: string, que: string): ElementoDeMatriz => ({ ruta, que });

const MOTOR = el("test/arquitectura/contratos/motor.ts", "el motor común de contratos (revisarContratos)");
const TEST_DE_CONTRATOS = el("test/arquitectura/contratos/contratos.test.ts", "el test del guardián sobre el repo real");
const ARNES = el("test/arquitectura/contratos/mutaciones-de-contratos.test.ts", "el arnés de mutaciones (esta matriz)");
const MANIFIESTO = el(ARCHIVO_DEL_MANIFIESTO, "el manifiesto de contratos");
const AREAS = el(ARCHIVO_DE_AREAS, "la declaración de áreas (AREAS) y su comparación con los usos reales");
const CLASIFICACION = el("test/arquitectura/contratos/gobernanza/clasificacion.ts", "la clasificación de rutas (REGLAS_DE_RUTA y clasificarRutas)");
const EXCLUSIONES = el("test/arquitectura/contratos/gobernanza/exclusiones.ts", "las exclusiones de la clasificación (EXCLUSIONES)");
const POLITICA = el("test/arquitectura/contratos/politica.ts", "la política de plazos y motivos (constantes y evaluarVencimientos)");
const VERIFICAN_GENERALES: readonly ElementoDeMatriz[] = [MOTOR, TEST_DE_CONTRATOS, ARNES];

// ---------------------------------------------------------------------------------------------------------------------------------
// Invariantes derivados de cada contrato
// ---------------------------------------------------------------------------------------------------------------------------------

const MOTIVO_EVASION_TRANSVERSAL =
  "las evasiones (apagar el test, excluirlo, sacarlo del CI) son transversales a todos los contratos: se prueban una vez, en el invariante guardian-no-neutralizable";

function invarianteDeContrato(base: BaseDeMutacion, c: Contrato): Invariante {
  const inv = `contrato/${c.id}`;
  const fuente = c.fuente.archivo;
  const definicion = `test/arquitectura/contratos/contratos/${c.id}.ts`;
  const ancla = el(fuente, `la ${fuente.endsWith(".css") ? "regla" : "función o constante exportada"} \`${c.fuente.ancla}\` (ancla de la fuente)`);
  const marca = el(fuente, `la marca @contrato ${c.id} en un comentario de la fuente`);
  const consumidor = elegirConsumidor(base, c);
  const m: MutacionDeMatriz[] = [];
  const noAplica: NoAplicaDeClase[] = [{ clase: "evasion", motivo: MOTIVO_EVASION_TRANSVERSAL }];
  const P = { contrato: c.id };

  // --- eliminación: el ancla, la marca, el archivo de la fuente, las entradas de la definición.
  m.push(mut(inv, "eliminacion", "ancla", { ...P, modo: "borrar" }, ancla, esp("motor", "fuente-ausente", fuente, "calculada", `la fuente de «${c.id}» no tiene el ancla`)));
  m.push(mut(inv, "eliminacion", "marca", { ...P, modo: "quitar" }, marca, esp("motor", "fuente-ausente", fuente, "calculada", `la fuente de «${c.id}» no lleva la marca`)));
  m.push(mut(inv, "eliminacion", "borrar-fuente", P, el(fuente, "el archivo de la fuente"), esp("motor", "fuente-ausente", fuente, "sin-posicion", `${definicion}:`)));
  const listas = [
    ["casos", c.casosLegitimos],
    ["excepciones", c.excepciones],
    ["deuda", c.deuda],
  ] as const;
  for (const [lista, entradas] of listas) {
    const probadas = new Set<string>();
    entradas.forEach((e, i) => {
      // Sacar la entrada vuelve a poner en rojo lo que cubría: un uso sin declarar, o una redefinición si el fragmento es de las que detecta `definicion`.
      const que = hallazgoDeEntrada(base, c, e);
      // Las entradas de una lista que cubren el mismo tipo de hallazgo en el mismo archivo pasan por el mismo detector (los 15 alias del salón de `tokens-visuales`): se prueba la primera, no
      // las 15, para que el arnés no crezca con la deuda. Una entrada de otro archivo o de otro tipo de hallazgo se prueba aparte.
      const clave = `${lista}|${e.archivo}|${que.tipo}`;
      if (probadas.has(clave)) return;
      probadas.add(clave);
      m.push(mut(inv, "eliminacion", "quitar-entrada", { ...P, lista, indice: String(i) }, el(definicion, `${lista}[${i}] de la definición (${e.archivo})`), esp("motor", que.tipo, e.archivo, "calculada", que.mensaje)));
    });
  }

  // Una fuente CSS de nombres: se le borra un token que algo usa (el uso queda sin definir) y, aparte, se le agrega uno que nadie usa.
  const tokenUsado = elegirTokenUsado(base, c);
  if (tokenUsado !== null) {
    m.push(mut(inv, "eliminacion", "quitar-token", P, el(fuente, `la definición de \`${tokenUsado.nombre}\` en la regla ancla (la usa ${tokenUsado.uso.ruta})`), esp("motor", "uso-sin-declarar", tokenUsado.uso.ruta, "calculada", "que la fuente no define")));
  }

  // --- alteración: el ancla renombrada, la marca con otro id.
  m.push(mut(inv, "alteracion", "ancla", { ...P, modo: "renombrar" }, ancla, esp("motor", "fuente-ausente", fuente, "calculada", `la fuente de «${c.id}» no tiene el ancla`)));
  m.push(mut(inv, "alteracion", "marca", { ...P, modo: "renombrar" }, marca, esp("motor", "marca-desconocida", fuente, "calculada", "no es de ningún contrato del manifiesto")));
  if (c.declaracion.tipo === "nombre-definido-en-la-fuente" && fuente.endsWith(".css")) {
    m.push(mut(inv, "alteracion", "agregar-token", P, ancla, esp("motor", "declaracion-sin-uso", fuente, "calculada", "y nadie lo usa")));
  }

  // --- duplicación: la marca copiada, una redefinición dentro del alcance.
  m.push(mut(inv, "duplicacion", "marca", { ...P, modo: "copiar", destino: `src/zz-marca-copiada-${c.id}.ts` }, marca, esp("motor", "marca-duplicada", `src/zz-marca-copiada-${c.id}.ts`, "calculada", "hay dos fuentes")));
  const nuevaDef = rutaNuevaEnElAlcance(base, c, "definicion");
  if (nuevaDef !== null) m.push(mut(inv, "duplicacion", "insertar", { ...P, que: "definicion" }, el(nuevaDef, "una redefinición de lo que la fuente define (archivo nuevo del alcance)"), esp("motor", "definicion-duplicada", nuevaDef, "calculada", "fuera de la fuente")));

  // --- desconexión: el contrato fuera del manifiesto, un consumidor que deja de declarar, nadie lo declara, un uso nuevo sin declarar, un área que no lo declara.
  m.push(mut(inv, "desconexion", "fuera-del-manifiesto", P, el(ARCHIVO_DEL_MANIFIESTO, `la entrada de «${c.id}» en el manifiesto`), esp("motor", "marca-desconocida", fuente, "calculada", "no es de ningún contrato del manifiesto")));
  if (consumidor !== null) {
    const mensaje = c.declaracion.tipo === "nombre-definido-en-la-fuente" ? "que la fuente no define" : "sin declarar el contrato";
    m.push(mut(inv, "desconexion", "quitar-declaracion", { ...P, ruta: consumidor.ruta }, el(consumidor.ruta, `la declaración del contrato (${c.declaracion.tipo}) en un consumidor real`), esp("motor", "uso-sin-declarar", consumidor.ruta, "calculada", mensaje)));
  }
  m.push(mut(inv, "desconexion", "quitar-todas-las-declaraciones", P, el(fuente, "todas las declaraciones de los consumidores"), esp("motor", "consumidor-fantasma", fuente, "sin-posicion", "ningún archivo del alcance declara el contrato")));
  const nuevoUso = rutaNuevaEnElAlcance(base, c, "uso");
  if (nuevoUso !== null) m.push(mut(inv, "desconexion", "insertar", { ...P, que: "uso" }, el(nuevoUso, "un consumidor nuevo con un uso crudo (archivo nuevo del alcance)"), esp("motor", "uso-sin-declarar", nuevoUso, "calculada", c.declaracion.tipo === "nombre-definido-en-la-fuente" ? "que la fuente no define" : "sin declarar el contrato")));
  const nuevaDecl = rutaNuevaEnElAlcance(base, c, "declaracion-sin-uso");
  if (nuevaDecl !== null) m.push(mut(inv, "desconexion", "insertar", { ...P, que: "declaracion-sin-uso" }, el(nuevaDecl, "una declaración del contrato sin nada que la use (archivo nuevo del alcance)"), esp("motor", "declaracion-sin-uso", nuevaDecl, "calculada", "que el contrato regule")));
  for (const [nombre, ids] of Object.entries(base.areas)) {
    if (!(ids as readonly string[]).includes(c.id)) continue;
    const delArea = archivosDelAlcance(base, c).some((r) => base.areaDeArchivo.get(r) === nombre);
    if (!delArea) continue;
    const uso = primerUsoDelArea(base, base.raiz, c, nombre);
    m.push(mut(inv, "desconexion", "area", { ...P, area: nombre, modo: "vaciar" }, el(ARCHIVO_DE_AREAS, `la entrada del área «${nombre}» que declara «${c.id}»`), esp("areas", "dependencia-omitida", uso.ruta, "calculada", `usa el contrato «${c.id}»`)));
  }

  // --- exclusión del análisis: el alcance movido de carpeta, un consumidor con una extensión que nadie analiza.
  const dentroDe = (raiz: string, ruta: string): boolean => ruta === raiz || ruta.startsWith(`${raiz.replace(/\/$/, "")}/`);
  if (!c.alcance.raices.some((r) => dentroDe(r, fuente))) {
    m.push(mut(inv, "exclusion-del-analisis", "sacar-alcance", P, el(c.alcance.raices[0] ?? fuente, `el alcance del contrato (${c.alcance.raices.join(", ")})`), esp("motor", "alcance-vacio", fuente, "sin-posicion", "no encontró ningún archivo")));
  } else {
    // La fuente vive DENTRO del alcance (un CSS global): mover todo el alcance se llevaría también la fuente y las de los demás contratos que la comparten, y no aislaría nada. Se mueve la última
    // raíz que no la contiene; el código que sale de las carpetas que el contrato mira no desaparece en silencio: la clasificación de rutas no reconoce la carpeta nueva.
    const raiz = [...c.alcance.raices].reverse().find((r) => !dentroDe(r, fuente) && base.archivos.some((a) => dentroDe(r, a) && a !== r));
    const movido = raiz === undefined ? undefined : base.archivos.find((a) => dentroDe(raiz, a) && a !== raiz);
    if (raiz !== undefined && movido !== undefined) {
      const dir = raiz.replace(/\/$/, "");
      m.push(mut(inv, "exclusion-del-analisis", "mover", { de: dir, a: `${dir}-movida` }, el(raiz, `una carpeta del alcance del contrato (${raiz}) cambia de nombre y queda fuera de lo que mira`), esp("clasificacion", "ruta-sin-clasificar", `${dir}-movida${movido.slice(dir.length)}`, "sin-posicion", "ninguna regla de clasificación reconoce este archivo")));
    }
  }
  if (consumidor !== null) {
    const ext = c.alcance.extensiones.find((e) => consumidor.ruta.endsWith(e)) ?? "";
    m.push(mut(inv, "exclusion-del-analisis", "extension-no-analizada", { ...P, ruta: consumidor.ruta }, el(consumidor.ruta, "un consumidor real que pasa a una extensión fuera del alcance"), esp("clasificacion", "ruta-sin-clasificar", `${consumidor.ruta.slice(0, consumidor.ruta.length - ext.length)}.jsx`, "sin-posicion", "ninguna regla de clasificación reconoce este archivo")));
  }

  return {
    id: inv,
    descripcion: `«${c.id}»: ${c.porQue}. Tiene UNA fuente (\`${c.fuente.ancla}\` en ${fuente}), una marca, y todo consumidor del alcance lo declara (${c.declaracion.tipo}); lo que se redefine fuera de la fuente falla.`,
    origen: "contrato",
    mecanismo: ["motor", "areas", "clasificacion"],
    elementos: {
      definen: [ancla, marca, el(definicion, "la definición del contrato (fuente, alcance, señales, declaración, casos legítimos)")],
      aplican: [el(c.alcance.raices.join(", "), `los consumidores del alcance, que declaran el contrato con «${c.declaracion.tipo}»`), MANIFIESTO, AREAS],
      verifican: VERIFICAN_GENERALES,
    },
    mutaciones: m,
    noAplica,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Invariantes propios del guardián
// ---------------------------------------------------------------------------------------------------------------------------------

function invariantesDelGuardian(base: BaseDeMutacion): Invariante[] {
  const primero = base.contratos[0];
  const conUso = base.contratos.find((c) => base.ejemplos[c.id]?.uso != null);
  const sinContratos = Object.entries(base.areas).find(([nombre, ids]) => ids.length === 0 && [...base.areaDeArchivo.values()].includes(nombre))?.[0] ?? "ui";
  const archivosDe = (prefijo: string): string[] => base.archivos.filter((a) => a.startsWith(prefijo));
  const primeroBajo = (prefijo: string, sufijo = ""): string => archivosDe(prefijo).find((a) => a.endsWith(sufijo)) ?? `${prefijo}(sin archivos)`;
  const exclusion = base.exclusiones[0];
  const out: Invariante[] = [];

  // --- 1. Clasificación completa de rutas.
  {
    const inv = "guardian/clasificacion-completa-de-rutas";
    const regla = el(CLASIFICACION.ruta, "una regla de REGLAS_DE_RUTA (src/ui/)");
    const reglaApp = base.reglas.find((r) => r.prefijo === "src/app/" && r.tipo === "frontend");
    const ultimaExt = reglaApp?.extensiones[reglaApp.extensiones.length - 1] ?? ".css";
    out.push({
      id: inv,
      descripcion: "Todo archivo del repo cae en UNA regla de clasificación (o en una exclusión escrita): un archivo que ninguna regla reconoce, dos reglas de tipos distintos para el mismo archivo, un cron sin archivo y código escondido por git son hallazgos.",
      origen: "guardian",
      mecanismo: ["clasificacion"],
      elementos: { definen: [regla], aplican: [el("git ls-files", "el listado de archivos del repo"), el("vercel.json", "los crons que se cruzan con la clasificación")], verifican: [CLASIFICACION, el("test/arquitectura/contratos/gobernanza/clasificacion.test.ts", "el test de la clasificación sobre el repo real"), ARNES] },
      mutaciones: [
        mut(inv, "eliminacion", "reglas", { modo: "quitar", prefijo: "src/ui/" }, regla, esp("clasificacion", "ruta-sin-clasificar", primeroBajo("src/ui/"), "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        mut(inv, "alteracion", "reglas", { modo: "extension", prefijo: "src/app/" }, el(CLASIFICACION.ruta, `la lista de extensiones de la regla src/app/ (${ultimaExt})`), esp("clasificacion", "ruta-sin-clasificar", primeroBajo("src/app/", ultimaExt), "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        mut(inv, "duplicacion", "reglas", { modo: "duplicar-otro-tipo", prefijo: "src/ui/" }, regla, esp("clasificacion", "clasificacion-ambigua", primeroBajo("src/ui/"), "sin-posicion", "reglas de tipos distintos")),
        mut(inv, "desconexion", "listado", { modo: "cron-fantasma" }, el("vercel.json", "un cron de vercel.json sin ruta de API"), esp("clasificacion", "cron-mal-clasificado", "src/app/api/cron/zz-fantasma/route.ts", "sin-posicion", "no tiene un archivo clasificado")),
        mut(inv, "exclusion-del-analisis", "listado", { modo: "ts-en-docs" }, el("docs/", "una carpeta que solo admite Markdown"), esp("clasificacion", "ruta-sin-clasificar", "docs/zz-codigo-escondido.ts", "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        mut(inv, "exclusion-del-analisis", "listado", { modo: "ignorado" }, el(".gitignore", "un patrón que esconde código bajo src/"), esp("clasificacion", "ignorado-en-raiz-de-codigo", "src/zz-oculto.ts", "sin-posicion", "git lo ignora")),
        mut(inv, "evasion", "listado", { modo: "vacio" }, el("git ls-files", "el listado de archivos (vacío)"), esp("clasificacion", "alcance-vacio", ".", "sin-posicion", "no hay ningún archivo para clasificar")),
      ],
      noAplica: [],
    });
  }

  // --- 2. Áreas declaradas.
  {
    const inv = "guardian/areas-declaran-sus-contratos";
    const idSinUso = primero?.id ?? "borde-propio-de-carta";
    const entrada = el(ARCHIVO_DE_AREAS, `la entrada del área «${sinContratos}» en AREAS`);
    const carpeta = "src/components/mesas";
    const areaMesas = "components/mesas";
    const hayMesas = archivosDe(`${carpeta}/`).length > 0 && base.areas[areaMesas] !== undefined;
    const pareja = Object.entries(base.areas).flatMap(([nombre, ids]) => ids.map((id) => [nombre, id] as const)).find(([nombre, id]) => base.contratos.some((c) => c.id === id) && base.areaDeArchivo.size > 0 && [...base.areaDeArchivo.values()].includes(nombre));
    const mutaciones: MutacionDeMatriz[] = [
      mut(inv, "eliminacion", "area", { area: sinContratos, modo: "quitar-entrada" }, entrada, esp("areas", "area-sin-declaracion", [...base.areaDeArchivo].find(([, a]) => a === sinContratos)?.[0] ?? "", "sin-posicion", "no declara sus contratos")),
      mut(inv, "alteracion", "area", { area: sinContratos, modo: "id-sin-uso", id: idSinUso }, entrada, esp("areas", "dependencia-falsa", ARCHIVO_DE_AREAS, "calculada", "ningún archivo del área lo usa")),
      mut(inv, "alteracion", "reglas", { modo: "frontend-sin-area" }, el(CLASIFICACION.ruta, "una regla de frontend en una carpeta que areaDe no sabe derivar"), esp("areas", "area-sin-clasificar", "src/zz-sin-area/x.ts", "sin-posicion", "no cae en ninguna área")),
      mut(inv, "duplicacion", "area", { area: sinContratos, modo: "id-repetido", id: idSinUso }, entrada, esp("areas", "dependencia-falsa", ARCHIVO_DE_AREAS, "calculada", "más de una vez")),
      mut(inv, "exclusion-del-analisis", "exclusion", { modo: "sobre-codigo", area: "ui" }, el(EXCLUSIONES.ruta, "una exclusión nueva sobre src/ui/ (bien gobernada): el área deja de tener archivos"), esp("areas", "area-fantasma", ARCHIVO_DE_AREAS, "calculada", "no hay ningún archivo en esa área")),
    ];
    if (pareja !== undefined) mutaciones.push(mut(inv, "desconexion", "area", { area: pareja[0], modo: "vaciar", contrato: pareja[1] }, el(ARCHIVO_DE_AREAS, `la entrada del área «${pareja[0]}» que declara «${pareja[1]}»`), esp("areas", "dependencia-omitida", primerUsoDelArea(base, base.raiz, base.contratos.find((c) => c.id === pareja[1]) ?? base.contratos[0], pareja[0]).ruta, "calculada", "y no lo declara")));
    if (hayMesas) {
      mutaciones.push(mut(inv, "exclusion-del-analisis", "mover", { de: carpeta, a: `${carpeta}-renombrada`, area: areaMesas }, el(carpeta, "la carpeta de un área que se renombra"), esp("areas", "area-fantasma", ARCHIVO_DE_AREAS, "calculada", "no hay ningún archivo en esa área")));
      mutaciones.push(mut(inv, "exclusion-del-analisis", "mover", { de: carpeta, a: `${carpeta}-renombrada` }, el(carpeta, "la carpeta de un área que se renombra"), esp("areas", "area-sin-declaracion", `${carpeta}-renombrada/${archivosDe(`${carpeta}/`)[0].slice(carpeta.length + 1)}`, "sin-posicion", "no declara sus contratos")));
    }
    out.push({
      id: inv,
      descripcion: "Cada área (carpeta de primer o segundo nivel) declara de qué contratos depende —o `[]`— y la declaración coincide con los usos reales en las dos direcciones; toda ruta de un tipo que declara pertenece a un área.",
      origen: "guardian",
      mecanismo: ["areas", "clasificacion"],
      elementos: { definen: [el(ARCHIVO_DE_AREAS, "AREAS: área → contratos que declara")], aplican: [el("test/arquitectura/contratos/gobernanza/usos.ts", "los usos reales de cada contrato por archivo"), CLASIFICACION], verifican: [AREAS, el("test/arquitectura/contratos/gobernanza/areas.test.ts", "el test de áreas sobre el repo real"), ARNES] },
      mutaciones,
      noAplica: [{ clase: "evasion", motivo: MOTIVO_EVASION_TRANSVERSAL }],
    });
  }

  // --- 3. Gobierno de excepciones, deuda, casos legítimos y exclusiones.
  if (conUso !== undefined && exclusion !== undefined) {
    const inv = "guardian/gobierno-de-excepciones-deuda-y-exclusiones";
    const nueva = rutaNuevaEnElAlcance(base, conUso, "gobierno") ?? "";
    const P = { contrato: conUso.id };
    const entrada = (que: string): ElementoDeMatriz => el(`test/arquitectura/contratos/contratos/${conUso.id}.ts`, que);
    const g = (clase: ClaseDeMutacion, defecto: string, que: string, tipo: string, mensaje: string, linea: EsperadoDeMutacion["linea"] = "sin-posicion", hueco = ""): MutacionDeMatriz =>
      mut(inv, clase, "gobierno", { ...P, defecto }, entrada(que), esp(hueco === "" ? "motor" : "ninguno", tipo, nueva, linea, mensaje), hueco);
    out.push({
      id: inv,
      descripcion: "Toda excepción, deuda y exclusión lleva motivo, responsable de la lista cerrada, aprobación con referencia válida y vencimiento dentro del plazo; vencida, duplicada, sin uso o sin gobierno falla. Los casos legítimos llevan motivo y se revisan en las dos direcciones.",
      origen: "guardian",
      mecanismo: ["motor", "politica", "clasificacion"],
      elementos: {
        definen: [el(`test/arquitectura/contratos/contratos/${conUso.id}.ts`, "casosLegitimos, excepciones y deuda de la definición del contrato"), el(EXCLUSIONES.ruta, "EXCLUSIONES de la clasificación")],
        aplican: [MOTOR, EXCLUSIONES],
        verifican: [MOTOR, CLASIFICACION, POLITICA, ARNES],
      },
      mutaciones: [
        g("eliminacion", "motivo-corto-excepcion", "el motivo de una excepción", "excepcion-sin-motivo", "no tiene motivo"),
        g("eliminacion", "motivo-corto-deuda", "el motivo de una deuda", "deuda-sin-motivo", "no tiene motivo"),
        g("eliminacion", "motivo-corto-caso", "el motivo de un caso legítimo", "caso-legitimo-sin-motivo", "no tiene motivo"),
        g("eliminacion", "responsable-ajeno", "el responsable de una excepción", "excepcion-sin-responsable", "responsable que no es de la lista cerrada"),
        g("eliminacion", "aprobacion-sin-referencia", "la aprobación de una excepción", "excepcion-sin-aprobacion", "no tiene aprobación válida"),
        mut(inv, "eliminacion", "exclusion", { modo: "sin-motivo" }, el(EXCLUSIONES.ruta, `el motivo de la exclusión de ${exclusion.ruta}`), esp("clasificacion", "excepcion-sin-motivo", exclusion.ruta, "sin-posicion", "no tiene motivo")),
        mut(inv, "eliminacion", "exclusion", { modo: "sin-responsable" }, el(EXCLUSIONES.ruta, `el responsable de la exclusión de ${exclusion.ruta}`), esp("clasificacion", "excepcion-sin-responsable", exclusion.ruta, "sin-posicion", "responsable que no es de la lista cerrada")),
        mut(inv, "eliminacion", "exclusion", { modo: "sin-aprobacion" }, el(EXCLUSIONES.ruta, `la aprobación de la exclusión de ${exclusion.ruta}`), esp("clasificacion", "excepcion-sin-aprobacion", exclusion.ruta, "sin-posicion", "no tiene aprobación válida")),
        g("alteracion", "vencida-excepcion", "el vencimiento de una excepción", "excepcion-vencida", "venció el"),
        g("alteracion", "vencida-deuda", "el vencimiento de una deuda", "deuda-vencida", "venció el"),
        g("alteracion", "plazo-excedido-excepcion", "el plazo de una excepción", "horizonte-excedido", "más de 60 días"),
        g("alteracion", "plazo-excedido-deuda", "el plazo de una deuda", "horizonte-excedido", "más de 60 días"),
        mut(inv, "alteracion", "exclusion", { modo: "vencida" }, el(EXCLUSIONES.ruta, `el vencimiento de la exclusión de ${exclusion.ruta}`), esp("clasificacion", "excepcion-vencida", exclusion.ruta, "sin-posicion", "venció el")),
        g("duplicacion", "excepcion-duplicada", "una excepción repetida", "excepcion-sobrante", "ya no corresponde a ningún uso"),
        g("duplicacion", "deuda-duplicada", "una deuda repetida", "deuda-sobrante", "ya no corresponde a ningún uso real"),
        g("duplicacion", "caso-duplicado", "un caso legítimo repetido", "caso-legitimo-sobrante", "ya no corresponde a ningún uso"),
        g("desconexion", "excepcion-de-otro-fragmento", "una excepción que ya no apunta al uso", "uso-sin-declarar", "sin declarar el contrato", "calculada"),
        mut(inv, "exclusion-del-analisis", "exclusion", { modo: "ampliada" }, el(EXCLUSIONES.ruta, `la cantidad exacta de archivos de ${exclusion.ruta}`), esp("clasificacion", "exclusion-ampliada", exclusion.ruta, "sin-posicion", "excluir más pide una aprobación nueva")),
        mut(inv, "exclusion-del-analisis", "exclusion", { modo: "sin-uso" }, el(EXCLUSIONES.ruta, `la cantidad exacta de archivos de ${exclusion.ruta}`), esp("clasificacion", "exclusion-sin-uso", exclusion.ruta, "sin-posicion", "bajá `archivos`")),
        mut(inv, "evasion", "exclusion", { modo: "lejana" }, el(EXCLUSIONES.ruta, `el vencimiento de la exclusión de ${exclusion.ruta} (sin vencimiento real)`), esp("clasificacion", "horizonte-excedido", exclusion.ruta, "sin-posicion", "más de 60 días")),
        g("evasion", "caso-que-silencia", "un caso legítimo agregado para tapar un uso crudo", "caso-legitimo-sin-aprobacion", "un caso legítimo nuevo exige aprobación", "calculada", "evasion/caso-legitimo-silencia-un-uso"),
      ],
      noAplica: [],
    });
  }

  // --- 4. Política de plazos (60 días) y motivos.
  {
    const inv = "guardian/politica-de-plazos";
    const t = (clase: ClaseDeMutacion, de: string, a: string, que: string, mensaje: string): MutacionDeMatriz =>
      mut(inv, clase, "texto", { ruta: POLITICA.ruta, de, a, pruebas: "test/arquitectura/contratos/motor.test.ts" }, el(POLITICA.ruta, que), esp("pruebas", "prueba-roja", POLITICA.ruta, "calculada", mensaje));
    out.push({
      id: inv,
      descripcion: "Toda excepción y toda deuda vencen como mucho 60 días después de su inicio, con motivo de 20 caracteres o más y un responsable de la lista cerrada; el vencimiento se evalúa con `evaluarVencimientos` y el motor lo aplica.",
      origen: "guardian",
      mecanismo: ["politica", "pruebas"],
      elementos: { definen: [POLITICA], aplican: [MOTOR, el(EXCLUSIONES.ruta, "revisarGobiernoDeExclusiones")], verifican: [el("test/arquitectura/contratos/motor.test.ts", "los tests de borde con literales (59/60/61 días, 19/20 caracteres)"), ARNES] },
      mutaciones: [
        t("eliminacion", 'RESPONSABLES: readonly Responsable[] = ["dueño"];', "RESPONSABLES: readonly Responsable[] = [];", "RESPONSABLES (la lista cerrada de responsables)", "responsable"),
        t("alteracion", "MOTIVO_MINIMO = 20;", "MOTIVO_MINIMO = 1;", "MOTIVO_MINIMO (largo mínimo de un motivo)", "motivo de 19 caracteres"),
        mut(inv, "desconexion", "texto", { ruta: "test/arquitectura/contratos/motor.ts", de: "const vencimientos = evaluarVencimientos(entradas, hoy);", a: "const vencimientos = { vencidas: [], excedidas: [], porVencer: [] };", pruebas: "test/arquitectura/contratos/motor.test.ts" }, el("test/arquitectura/contratos/motor.ts", "la llamada a evaluarVencimientos en revisarContrato"), esp("pruebas", "prueba-roja", "test/arquitectura/contratos/motor.ts", "calculada", "vence ayer")),
        mut(inv, "exclusion-del-analisis", "mover", { de: POLITICA.ruta, a: "docs/politica.ts" }, POLITICA, esp("clasificacion", "ruta-sin-clasificar", "docs/politica.ts", "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        t("evasion", "HORIZONTE_EXCEPCION_DIAS = 60;", "HORIZONTE_EXCEPCION_DIAS = 365;", "HORIZONTE_EXCEPCION_DIAS (60 → 365)", "tope de una excepción"),
        t("evasion", "HORIZONTE_DEUDA_DIAS = 60;", "HORIZONTE_DEUDA_DIAS = 365;", "HORIZONTE_DEUDA_DIAS (60 → 365)", "tope de una deuda"),
      ],
      noAplica: [{ clase: "duplicacion", motivo: "las constantes de la política viven en un único módulo (politica.ts): no hay un segundo lugar donde duplicarlas" }],
    });
  }

  // --- 5. Marcas únicas y conocidas.
  if (primero !== undefined) {
    const inv = "guardian/marcas-unicas-y-conocidas";
    const marca = el(primero.fuente.archivo, `la marca @contrato ${primero.id}`);
    out.push({
      id: inv,
      descripcion: "Cada contrato tiene EXACTAMENTE una marca, en su fuente; una marca de un contrato que no está en el manifiesto, o copiada a otro archivo, es un hallazgo; el código que el motor no analiza (otra extensión, otra carpeta) lo ve la clasificación.",
      origen: "guardian",
      mecanismo: ["motor", "clasificacion"],
      elementos: { definen: [marca], aplican: [MANIFIESTO, MOTOR], verifican: [MOTOR, CLASIFICACION, ARNES] },
      mutaciones: [
        mut(inv, "alteracion", "marca", { contrato: primero.id, modo: "copiar-desconocida", destino: "src/zz-marca-desconocida.ts" }, marca, esp("motor", "marca-desconocida", "src/zz-marca-desconocida.ts", "calculada", "no es de ningún contrato del manifiesto")),
        mut(inv, "duplicacion", "marca", { contrato: primero.id, modo: "copiar", destino: "src/zz-marca-duplicada.ts" }, marca, esp("motor", "marca-duplicada", "src/zz-marca-duplicada.ts", "calculada", "hay dos fuentes")),
        mut(inv, "desconexion", "fuera-del-manifiesto", { contrato: primero.id }, marca, esp("motor", "marca-desconocida", primero.fuente.archivo, "calculada", "no es de ningún contrato del manifiesto")),
        mut(inv, "exclusion-del-analisis", "marca", { contrato: primero.id, modo: "copiar", destino: "src/zz-marca-copiada.mjs" }, marca, esp("clasificacion", "ruta-sin-clasificar", "src/zz-marca-copiada.mjs", "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        mut(inv, "exclusion-del-analisis", "marca", { contrato: primero.id, modo: "copiar", destino: "docs/zz-marca-copiada.ts" }, marca, esp("clasificacion", "ruta-sin-clasificar", "docs/zz-marca-copiada.ts", "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
      ],
      noAplica: [
        { clase: "eliminacion", motivo: "quitar la marca de un contrato es la mutación `marca · quitar` de cada invariante de contrato (contrato/<id>)" },
        { clase: "evasion", motivo: MOTIVO_EVASION_TRANSVERSAL },
      ],
    });
  }

  // --- 6. Consistencia del manifiesto.
  if (primero !== undefined) {
    const inv = "guardian/manifiesto-consistente";
    const roto = (clase: ClaseDeMutacion, modo: string, mensaje: string): MutacionDeMatriz => mut(inv, clase, "manifiesto-roto", { contrato: primero.id, modo }, MANIFIESTO, esp("manifiesto", "manifiesto-mal-armado", ARCHIVO_DEL_MANIFIESTO, "sin-posicion", mensaje));
    out.push({
      id: inv,
      descripcion: "El manifiesto está bien armado (ids únicos y kebab-case, señales, declaración compatible) y coincide con las áreas: un manifiesto mal armado lanza, y un área que declara un contrato que no existe falla.",
      origen: "guardian",
      mecanismo: ["motor", "areas"],
      elementos: { definen: [MANIFIESTO], aplican: [el("test/arquitectura/contratos/contratos/", "un archivo por contrato"), AREAS], verifican: [MOTOR, el("test/arquitectura/contratos/gobernanza/areas.test.ts", "los ids declarables existen en el manifiesto"), ARNES] },
      mutaciones: [
        roto("eliminacion", "sin-senales", "sin `senales`"),
        roto("alteracion", "id-malo", "kebab-case"),
        roto("duplicacion", "duplicar", "id repetido"),
        mut(inv, "desconexion", "area", { area: sinContratos, modo: "id-fantasma" }, AREAS, esp("areas", "dependencia-falsa", ARCHIVO_DE_AREAS, "calculada", "no existe en el manifiesto")),
      ],
      noAplica: [
        { clase: "exclusion-del-analisis", motivo: "el manifiesto no depende de un alcance: es un módulo TypeScript que importan los tests; moverlo a una ruta no analizada está en guardian-no-neutralizable" },
        { clase: "evasion", motivo: MOTIVO_EVASION_TRANSVERSAL },
      ],
    });
  }

  // --- 7. El guardián no se puede neutralizar.
  if (primero !== undefined) {
    const inv = "guardian/guardian-no-neutralizable";
    const t = "test/arquitectura/contratos/contratos.test.ts";
    const futuro = (m: string): EsperadoDeMutacion => esp("ninguno", "guardian-neutralizado", t, "calculada", m);
    out.push({
      id: inv,
      descripcion: "Apagar, excluir, renombrar, mover o desconectar del CI el test del guardián, vaciar el manifiesto o bajar un plazo tiene que fallar. HOY algunos intentos no tienen mecanismo (el guardián del guardián y la revisión del CI son G6/G7): quedan como hueco conocido con su deuda.",
      origen: "guardian",
      mecanismo: ["motor", "clasificacion", "pruebas"],
      elementos: {
        definen: [TEST_DE_CONTRATOS, MANIFIESTO, el("vitest.config.ts", "la configuración de Vitest (include/exclude)"), el(".github/workflows/ci.yml", "el workflow de CI (paso npm test)"), el("package.json", "los scripts (test)")],
        aplican: [POLITICA, el("vitest.config.ts", "qué archivos corre npm test")],
        verifican: [MOTOR, CLASIFICACION, el("test/arquitectura/contratos/motor.test.ts", "los tests de borde de la política"), ARNES],
      },
      mutaciones: [
        mut(inv, "eliminacion", "vaciar-manifiesto", {}, MANIFIESTO, esp("motor", "marca-desconocida", primero.fuente.archivo, "calculada", "no es de ningún contrato del manifiesto")),
        mut(inv, "alteracion", "texto", { ruta: POLITICA.ruta, de: "HORIZONTE_EXCEPCION_DIAS = 60;", a: "HORIZONTE_EXCEPCION_DIAS = 365;", pruebas: "test/arquitectura/contratos/motor.test.ts" }, el(POLITICA.ruta, "el plazo de una excepción (60 → 365)"), esp("pruebas", "prueba-roja", POLITICA.ruta, "calculada", "tope de una excepción")),
        mut(inv, "desconexion", "texto", { ruta: ".github/workflows/ci.yml", de: "run: npm test", a: "run: echo omitido" }, el(".github/workflows/ci.yml", "el paso `npm test` del job de integración"), futuro("el workflow ya no corre npm test"), "desconexion/ci-sin-paso"),
        mut(inv, "desconexion", "texto", { ruta: ".github/workflows/ci.yml", de: "- name: npm test\n", a: "- name: npm test\n        continue-on-error: true\n" }, el(".github/workflows/ci.yml", "el paso `npm test` del job de integración"), futuro("el paso de tests tiene continue-on-error"), "desconexion/ci-continue-on-error"),
        mut(inv, "desconexion", "texto", { ruta: "package.json", de: '    "test": "vitest run",\n', a: "" }, el("package.json", 'el script "test"'), futuro('package.json ya no tiene el script "test"'), "desconexion/script-quitado"),
        mut(inv, "exclusion-del-analisis", "mover", { de: ARCHIVO_DEL_MANIFIESTO, a: "docs/manifiesto.ts" }, MANIFIESTO, esp("clasificacion", "ruta-sin-clasificar", "docs/manifiesto.ts", "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        mut(inv, "exclusion-del-analisis", "mover", { de: t, a: `${t}.bak` }, TEST_DE_CONTRATOS, esp("clasificacion", "ruta-sin-clasificar", `${t}.bak`, "sin-posicion", "ninguna regla de clasificación reconoce este archivo")),
        mut(inv, "evasion", "texto", { ruta: t, de: 'describe("contratos compartidos declarados (repo real)"', a: 'describe.skip("contratos compartidos declarados (repo real)"' }, TEST_DE_CONTRATOS, futuro("el test del guardián está apagado (describe.skip)"), "evasion/test-desactivado"),
        mut(inv, "evasion", "texto", { ruta: "vitest.config.ts", de: 'exclude: [...configDefaults.exclude, "test/e2e/**"', a: 'exclude: [...configDefaults.exclude, "test/arquitectura/**", "test/e2e/**"' }, el("vitest.config.ts", "el exclude de Vitest"), futuro("vitest.config.ts excluye el test del guardián"), "evasion/test-excluido-en-vitest"),
        mut(inv, "evasion", "mover", { de: t, a: "test/arquitectura/contratos/contratos-guardian.ts" }, TEST_DE_CONTRATOS, futuro("el test del guardián ya no termina en .test.ts"), "evasion/test-renombrado-a-ts"),
      ],
      noAplica: [{ clase: "duplicacion", motivo: "duplicar el guardián no lo neutraliza: dos copias del test hacen lo mismo y nada se evade" }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La matriz
// ---------------------------------------------------------------------------------------------------------------------------------

export interface Matriz {
  invariantes: readonly Invariante[];
  /** Contratos del manifiesto que no tienen entrada en `EJEMPLOS_DE_CONTRATOS`: la matriz está desactualizada. */
  sinEjemplos: readonly string[];
}

export function construirMatriz(base: BaseDeMutacion): Matriz {
  return {
    invariantes: [...base.contratos.map((c) => invarianteDeContrato(base, c)), ...invariantesDelGuardian(base)],
    sinEjemplos: base.contratos.filter((c) => base.ejemplos[c.id] === undefined).map((c) => c.id),
  };
}
