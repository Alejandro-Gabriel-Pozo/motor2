import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listarArchivos } from "../cercos/trinquete";
import { primeraClase, coincidenciasDeClases, coincidenciasPorToken } from "./adaptadores/clases-tsx";
import { colapsar, prueba, type Coincidencia } from "./adaptadores/coincidencia";
import { coincidenciasDeCss, dentroDeLaRegla, primeraReglaConClase, reglaDelAncla, variablesDefinidas } from "./adaptadores/css";
import { coincidenciasDeTs, importaElAncla, posicionDelSimboloExportado } from "./adaptadores/ts";
import { Indice, esCss, esTs } from "./indice";
import { MOTIVO_MINIMO, RENOVACIONES_SIN_AVISO, RESPONSABLES, esFechaValida, evaluarVencimientos, referenciaValida, type EntradaConVencimiento } from "./politica";
import type { Aviso, Contrato, Detector, Hallazgo, Resultado, TipoDeHallazgo } from "./tipos";

/**
 * El motor común de «contratos compartidos declarados» (ver `LEEME.md`). Recibe la raíz de un repo y un manifiesto de contratos y devuelve los hallazgos, ordenados y
 * deterministas. Fail-closed: lo que se USA sin declarar de qué contrato depende falla; no hay línea de base que solo cuente, la deuda se escribe uso por uso.
 *
 * UN solo recorrido: se lista el repo una vez, cada archivo se lee y se parsea una vez (`Indice`) y los adaptadores comparten ese índice entre todos los contratos.
 * Reusa del trinquete de los cercos el recorrido (`listarArchivos`) y `sinComentarios`, sin modificarlos.
 *
 * Un manifiesto mal armado (id repetido, declaración incompatible con sus señales…) no es un hallazgo: es un error del propio manifiesto y el motor lo lanza.
 */

/** Dónde se buscan marcas sueltas del contrato: una marca que no es de ningún contrato del manifiesto es un hallazgo. */
const RAICES_DE_MARCAS: readonly string[] = ["src", "plataforma", "scripts", "prisma", "test"];
const EXTENSIONES_BASE: readonly string[] = [".ts", ".tsx", ".css"];
const RE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** La marca de la fuente: el arroba, la palabra «contrato» y el id de un contrato; solo cuenta dentro de un comentario. */
const RE_MARCA = /@contrato[ \t]+([A-Za-z0-9][\w-]*)/g;
/** Dónde vive la definición de cada contrato del repo (un archivo por contrato, con el nombre de su id): el diagnóstico de la fuente la cita. */
const CARPETA_DE_DEFINICIONES = "test/arquitectura/contratos/contratos";

export interface OpcionesDelMotor {
  /** Raíz del repo (o de un árbol temporal en las pruebas). */
  raiz: string;
  contratos: readonly Contrato[];
  /** El día de hoy, `AAAA-MM-DD`: lo inyecta quien llama (los tests, uno fijo; el guardián real, `fechaUtcDeHoy()`). */
  hoy: string;
}

interface Marca {
  id: string;
  ruta: string;
  desde: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Validación del manifiesto
// ---------------------------------------------------------------------------------------------------------------------------------

function validarManifiesto(contratos: readonly Contrato[]): void {
  const problemas: string[] = [];
  const ids = new Set<string>();
  for (const c of contratos) {
    const en = `contrato «${c.id}»`;
    if (!RE_ID.test(c.id)) problemas.push(`${en}: el id tiene que ser kebab-case (minúsculas, dígitos y guiones)`);
    if (ids.has(c.id)) problemas.push(`${en}: id repetido en el manifiesto`);
    ids.add(c.id);
    if (c.porQue.trim().length < MOTIVO_MINIMO) problemas.push(`${en}: \`porQue\` tiene que decir el riesgo (${MOTIVO_MINIMO} caracteres o más)`);
    if (!/\.(css|tsx?)$/.test(c.fuente.archivo)) problemas.push(`${en}: la fuente tiene que ser un .ts, .tsx o .css (${c.fuente.archivo})`);
    if (!c.fuente.ancla.trim()) problemas.push(`${en}: la fuente necesita un ancla`);
    if (c.senales.length === 0) problemas.push(`${en}: sin \`senales\` el contrato nunca detectaría un uso`);
    const adaptadores = c.senales.map((s) => (s.adaptador === "ts" ? `ts/${s.tipo}` : s.adaptador === "css" ? `css/${s.tipo}` : "clases"));
    if (c.declaracion.tipo === "importar-ancla" && c.senales.some((s) => s.adaptador !== "ts")) problemas.push(`${en}: «importar-ancla» solo va con señales del adaptador ts (hay ${adaptadores.join(", ")})`);
    if (c.declaracion.tipo === "importar-ancla" && !/\.tsx?$/.test(c.fuente.archivo)) problemas.push(`${en}: «importar-ancla» necesita una fuente .ts o .tsx`);
    if (c.declaracion.tipo === "clase-companera" && c.senales.some((s) => s.adaptador === "ts")) problemas.push(`${en}: «clase-companera» solo va con señales de clases o css (hay ${adaptadores.join(", ")})`);
    if (c.declaracion.tipo === "clase-companera" && !c.declaracion.clase.trim()) problemas.push(`${en}: la clase compañera no puede ser vacía`);
    if (c.declaracion.tipo === "nombre-definido-en-la-fuente") {
      if (c.senales.some((s) => !((s.adaptador === "css" && s.tipo === "variable") || (s.adaptador === "ts" && s.tipo === "codigo") || s.adaptador === "clases"))) {
        problemas.push(`${en}: «nombre-definido-en-la-fuente» solo va con señales css/variable, ts/codigo o clases (hay ${adaptadores.join(", ")})`);
      }
      // Un detector de clases nombra un token por su grupo `(?<nombre>…)`; el nombre que se verifica es `prefijoDeNombre` + ese grupo.
      for (const s of c.senales) {
        if (s.adaptador !== "clases") continue;
        if (typeof c.declaracion.prefijoDeNombre !== "string" || !c.declaracion.prefijoDeNombre.trim()) problemas.push(`${en}: «nombre-definido-en-la-fuente» con señales de clases necesita \`prefijoDeNombre\` (por ejemplo «--color-»)`);
        if (!s.token.source.includes("(?<nombre>")) problemas.push(`${en}: el detector de clases «${s.que}» con «nombre-definido-en-la-fuente» tiene que llevar el grupo con nombre \`(?<nombre>…)\` en su regex`);
      }
    }
    for (const [clase, entradas] of [["excepción", c.excepciones], ["deuda", c.deuda]] as const) {
      for (const e of entradas) {
        const fechas = [["vence", e.vence], ["creada", e.creada], ...e.renovaciones.map((r) => ["renovación", r.fecha])];
        for (const [campo, valor] of fechas) if (!esFechaValida(valor)) problemas.push(`${en}: la ${clase} de «${e.fragmento}» tiene ${campo} «${valor}», que no es una fecha AAAA-MM-DD válida`);
      }
    }
    if (Array.isArray(c.consumidores) && new Set(c.consumidores).size !== c.consumidores.length) problemas.push(`${en}: \`consumidores\` repite un archivo`);
  }
  if (problemas.length > 0) throw new Error(`Manifiesto de contratos mal armado:\n${problemas.map((p) => `  - ${p}`).join("\n")}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lista el repo UNA vez: las raíces de marcas, las carpetas de los alcances y las fuentes, con las extensiones que hagan falta. */
function listar(raiz: string, contratos: readonly Contrato[]): string[] {
  const carpetas = new Set<string>(RAICES_DE_MARCAS);
  const sueltos = new Set<string>();
  const extensiones = new Set<string>(EXTENSIONES_BASE);
  const agregar = (ruta: string): void => {
    const absoluta = join(raiz, ...ruta.split("/"));
    if (!existsSync(absoluta)) return;
    if (statSync(absoluta).isDirectory()) carpetas.add(ruta);
    else sueltos.add(ruta);
  };
  for (const c of contratos) {
    c.alcance.raices.forEach(agregar);
    c.alcance.extensiones.forEach((e) => extensiones.add(e));
    agregar(c.fuente.archivo);
  }
  const salida = new Set(listarArchivos(raiz, [...carpetas], [...extensiones]));
  for (const s of sueltos) if ([...extensiones].some((e) => s.endsWith(e))) salida.add(s);
  return [...salida].sort();
}

const enAlcance = (c: Contrato, ruta: string): boolean => c.alcance.extensiones.some((e) => ruta.endsWith(e)) && c.alcance.raices.some((r) => ruta === r || ruta.startsWith(`${r.replace(/\/$/, "")}/`));

/** Las marcas del contrato en comentarios de todo el repo. Una marca dentro de un string no cuenta: el `@` sigue ahí cuando se quitan los comentarios. */
function leerMarcas(indice: Indice): Marca[] {
  const marcas: Marca[] = [];
  for (const ruta of indice.todas) {
    const fuente = indice.fuente(ruta);
    if (!fuente.includes("@contrato")) continue;
    const limpia = indice.limpia(ruta);
    for (const m of fuente.matchAll(RE_MARCA)) if (limpia[m.index] !== "@") marcas.push({ id: m[1], ruta, desde: m.index });
  }
  return marcas;
}

/** Lo que un detector encuentra en un archivo (los adaptadores que no aplican a la extensión del archivo no encuentran nada). */
function coincidenciasDe(d: Detector, ruta: string, indice: Indice, prefijoDeNombre: string | null): Coincidencia[] {
  if (d.adaptador === "css") return esCss(ruta) ? coincidenciasDeCss(indice.reglas(ruta), d) : [];
  if (!esTs(ruta)) return [];
  // Con `nombre-definido-en-la-fuente` el token de clase es un nombre y cada token de la cadena cuenta; si no, una coincidencia por cadena.
  if (d.adaptador === "clases") return prefijoDeNombre === null ? coincidenciasDeClases(indice.cadenas(ruta), d.token) : coincidenciasPorToken(indice.cadenas(ruta), d.token, prefijoDeNombre);
  // El texto crudo es un superset del código: si el patrón no está ni ahí, no hace falta parsear el archivo.
  if (d.tipo === "codigo" && !prueba(d.patron, indice.fuente(ruta))) return [];
  return coincidenciasDeTs(indice.archivoTs(ruta), d);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Un contrato
// ---------------------------------------------------------------------------------------------------------------------------------

interface Dato {
  ruta: string;
  desde: number;
  /** El hallazgo si nadie lo exceptúa ni lo declara como deuda. */
  tipo: "uso-sin-declarar" | "definicion-duplicada";
  que: string;
  como: string;
  fragmento: string;
}

function comoDeclarar(c: Contrato): string {
  const d = c.declaracion;
  if (d.tipo === "importar-ancla") return `importá \`${c.fuente.ancla}\` de «${c.fuente.archivo}»`;
  if (d.tipo === "clase-companera") return `agregá la clase \`${d.clase}\` a esa cadena de clases (o \`.${d.clase}\` al selector de la regla)`;
  return `usá un nombre que defina «${c.fuente.archivo}» (o definilo ahí)`;
}

/** Dónde está definido el contrato (convención: `contratos/<id>.ts`): la ruta con la línea de su `id:` si el archivo existe en `raiz`; si no, dice que no está en este árbol. */
function dondeSeDefine(raiz: string, id: string): string {
  const ruta = `${CARPETA_DE_DEFINICIONES}/${id}.ts`;
  const absoluta = join(raiz, ...ruta.split("/"));
  if (!existsSync(absoluta)) return `el manifiesto de contratos (no hay «${ruta}» en este árbol)`;
  const lineas = readFileSync(absoluta, "utf8").split("\n");
  const i = lineas.findIndex((l) => new RegExp(`\\bid:\\s*["']${id}["']`).test(l));
  return `«${ruta}:${i < 0 ? 1 : i + 1}»`;
}

function revisarContrato(c: Contrato, indice: Indice, marcas: readonly Marca[], hoy: string, avisos: Aviso[], raiz: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  let fuenteTexto = c.fuente.archivo;
  const pos = (ruta: string, desde: number): { linea: number; columna: number } => (indice.tiene(ruta) ? indice.posicion(ruta, desde) : { linea: 1, columna: 1 });
  const agregar = (tipo: TipoDeHallazgo, ruta: string, desde: number, que: string, como: string, fragmento = ""): void => {
    hallazgos.push({ contrato: c.id, tipo, archivo: ruta, ...pos(ruta, desde), que, como, fragmento, fuente: fuenteTexto });
  };

  // --- Casos legítimos, excepciones y deuda: los que no tienen motivo fallan aunque se usen.
  for (const k of c.casosLegitimos) {
    if (k.motivo.trim().length < MOTIVO_MINIMO) agregar("caso-legitimo-sin-motivo", k.archivo, 0, `el caso legítimo de «${colapsar(k.fragmento)}» no tiene motivo (${MOTIVO_MINIMO} caracteres o más)`, "escribí por qué este uso es legítimo y permanente: no es un separador ni lo que el contrato regula");
  }
  for (const e of c.excepciones) {
    if (e.motivo.trim().length < MOTIVO_MINIMO) agregar("excepcion-sin-motivo", e.archivo, 0, `la excepción de «${e.fragmento}» no tiene motivo (${MOTIVO_MINIMO} caracteres o más)`, "escribí por qué este uso no declara el contrato");
  }
  for (const d of c.deuda) {
    if (d.motivo.trim().length < MOTIVO_MINIMO) agregar("deuda-sin-motivo", d.archivo, 0, `la deuda de «${d.fragmento}» no tiene motivo (${MOTIVO_MINIMO} caracteres o más)`, "escribí por qué quedó sin declarar");
    else if (!d.resuelveEn.trim()) agregar("deuda-sin-motivo", d.archivo, 0, `la deuda de «${d.fragmento}» no dice dónde se resuelve`, "completá `resuelveEn` (el paso, la fase o el pendiente que la paga)");
  }

  // --- Gobierno de las excepciones y la deuda: responsable de la lista cerrada, aprobación con referencia válida, vencimiento dentro del horizonte.
  const entradas: EntradaConVencimiento[] = [];
  for (const [clase, lista] of [["excepcion", c.excepciones], ["deuda", c.deuda]] as const) {
    for (const e of lista) {
      const nombre = `la ${clase === "deuda" ? "deuda" : "excepción"} de «${colapsar(e.fragmento)}»`;
      if (!RESPONSABLES.includes(e.responsable)) agregar("excepcion-sin-responsable", e.archivo, 0, `${nombre} tiene un responsable que no es de la lista cerrada («${e.responsable}»)`, `poné uno de: ${RESPONSABLES.join(", ")}`);
      if (!e.aprobacion.por.trim() || !referenciaValida(e.aprobacion.referencia)) {
        agregar("excepcion-sin-aprobacion", e.archivo, 0, `${nombre} no tiene aprobación válida (por «${e.aprobacion.por}», referencia «${e.aprobacion.referencia}»)`, "escribí quién la aprobó y la referencia: `PR #n`, `commit <sha>` o `DEC-nn`");
      }
      // Una renovación sin justificación o sin aprobación no renueva nada: falla como una entrada nueva sin motivo o sin aprobación.
      for (const r of e.renovaciones) {
        if (r.motivo.trim().length < MOTIVO_MINIMO) {
          agregar(clase === "deuda" ? "deuda-sin-motivo" : "excepcion-sin-motivo", e.archivo, 0, `la renovación del ${r.fecha} de ${nombre} no tiene motivo (${MOTIVO_MINIMO} caracteres o más)`, "escribí por qué se renueva: no se renueva sin justificación");
        }
        if (!r.aprobacion.por.trim() || !referenciaValida(r.aprobacion.referencia)) {
          agregar("excepcion-sin-aprobacion", e.archivo, 0, `la renovación del ${r.fecha} de ${nombre} no tiene aprobación válida (por «${r.aprobacion.por}», referencia «${r.aprobacion.referencia}»)`, "escribí quién la aprobó y la referencia: `PR #n`, `commit <sha>` o `DEC-nn`");
        }
      }
      if (clase === "deuda" && e.renovaciones.length > RENOVACIONES_SIN_AVISO) {
        avisos.push({ contrato: c.id, clase, archivo: e.archivo, fragmento: colapsar(e.fragmento), tipo: "muchas-renovaciones", renovaciones: e.renovaciones.length });
      }
      const inicio = e.renovaciones.reduce((ultima, r) => (r.fecha > ultima ? r.fecha : ultima), e.creada);
      entradas.push({ clase, archivo: e.archivo, fragmento: colapsar(e.fragmento), inicio, vence: e.vence });
    }
  }
  const vencimientos = evaluarVencimientos(entradas, hoy);
  for (const v of vencimientos.vencidas) {
    agregar(v.clase === "deuda" ? "deuda-vencida" : "excepcion-vencida", v.archivo, 0, `${v.clase === "deuda" ? "la deuda" : "la excepción"} de «${v.fragmento}» venció el ${v.vence} (hoy es ${hoy})`, "pagala (sacala y declará el contrato) o renovala con una nueva aprobación y otra fecha");
  }
  for (const v of vencimientos.excedidas) {
    const quien = `${v.clase === "deuda" ? "la deuda" : "la excepción"} de «${v.fragmento}»`;
    const que = v.inicio > hoy ? `${quien} tiene un inicio (${v.inicio}) posterior a hoy (${hoy})` : `${quien} vence el ${v.vence}, más de ${v.tope} días después de su inicio (${v.inicio}: la última renovación o la creación)`;
    agregar("horizonte-excedido", v.archivo, 0, que, "poné una fecha de vencimiento más cercana o renová con motivo y aprobación (los topes están en `politica.ts`)");
  }
  for (const v of vencimientos.porVencer) avisos.push({ contrato: c.id, clase: v.clase, archivo: v.archivo, fragmento: v.fragmento, tipo: "vence-pronto", vence: v.vence, dias: v.dias });

  // --- La fuente: existe, lleva UNA marca y tiene el ancla. Cada hallazgo apunta a una línea real: si falta la marca, a la del ancla; si falta el ancla, a la de la marca;
  // si falta todo (o el archivo), a 1:1 y el mensaje dice DÓNDE está definido el contrato y qué corregir.
  const fuenteEsta = indice.tiene(c.fuente.archivo);
  const delContrato = marcas.filter((m) => m.id === c.id);
  const enFuente = delContrato.filter((m) => m.ruta === c.fuente.archivo);
  const definido = dondeSeDefine(raiz, c.id);
  const reglaAncla = fuenteEsta && esCss(c.fuente.archivo) ? reglaDelAncla(indice.reglas(c.fuente.archivo), c.fuente.ancla) : null;
  const ancla = !fuenteEsta ? null : esCss(c.fuente.archivo) ? (reglaAncla?.desde ?? null) : posicionDelSimboloExportado(indice.arbol(c.fuente.archivo), c.fuente.ancla);
  const dondeApuntar = ancla ?? enFuente[0]?.desde ?? 0;
  if (!fuenteEsta) {
    agregar("fuente-ausente", c.fuente.archivo, 0, `la fuente de «${c.id}» no existe: el archivo de la fuente no existe`, `restaurá «${c.fuente.archivo}» o corregí \`fuente.archivo\` del contrato, definido en ${definido}`);
  } else if (enFuente.length === 0) {
    agregar("fuente-ausente", c.fuente.archivo, ancla ?? 0, `la fuente de «${c.id}» no lleva la marca \`@contrato ${c.id}\` en un comentario`, `agregá un comentario con \`@contrato ${c.id}\` junto al ancla \`${c.fuente.ancla}\` (el contrato está definido en ${definido})`);
  }
  for (const m of [...enFuente.slice(1), ...delContrato.filter((x) => x.ruta !== c.fuente.archivo)]) {
    agregar("marca-duplicada", m.ruta, m.desde, `la marca \`@contrato ${c.id}\` ya está en la fuente «${c.fuente.archivo}»: hay dos fuentes`, "dejá UNA sola marca en la fuente (si el contrato se copió, sacá la copia y que use la fuente)");
  }
  if (fuenteEsta) {
    if (ancla === null) {
      agregar(
        "fuente-ausente",
        c.fuente.archivo,
        dondeApuntar,
        `la fuente de «${c.id}» no tiene el ancla \`${c.fuente.ancla}\``,
        `${esCss(c.fuente.archivo) ? "agregá la regla con ese selector o corregí `fuente.ancla`" : "exportá ese símbolo o corregí `fuente.ancla`"} (el contrato está definido en ${definido})`
      );
    } else fuenteTexto = `${c.fuente.archivo}:${indice.posicion(c.fuente.archivo, ancla).linea}`;
    if (c.declaracion.tipo === "clase-companera" && esCss(c.fuente.archivo) && primeraReglaConClase(indice.reglas(c.fuente.archivo), c.declaracion.clase) === null) {
      agregar("fuente-ausente", c.fuente.archivo, dondeApuntar, `la fuente de «${c.id}» no define la clase compañera \`.${c.declaracion.clase}\``, `definí esa clase en la fuente o corregí \`declaracion.clase\` (el contrato está definido en ${definido})`);
    }
  }

  // --- El alcance.
  // Una fuente CSS dentro del alcance se revisa como un consumidor más (puede usar y puede redefinir), salvo lo que cae dentro de su regla ancla: lo que define la fuente no es un uso.
  const fuenteRevisada = fuenteEsta && esCss(c.fuente.archivo) && enAlcance(c, c.fuente.archivo);
  const archivos = indice.todas.filter((r) => enAlcance(c, r) && (r !== c.fuente.archivo || fuenteRevisada));
  const enElAncla = (ruta: string, desde: number): boolean => fuenteRevisada && ruta === c.fuente.archivo && reglaAncla !== null && dentroDeLaRegla(reglaAncla, desde);
  if (!indice.todas.some((r) => enAlcance(c, r))) {
    agregar("alcance-vacio", c.fuente.archivo, 0, `el alcance (${c.alcance.raices.join(", ")} · ${c.alcance.extensiones.join(", ")}) no encontró ningún archivo`, "corregí las raíces o las extensiones: un contrato sin archivos pasaría en vacío");
    return hallazgos;
  }
  if (!fuenteEsta) return hallazgos;

  // --- Cada archivo del alcance: usos, definiciones y si declara.
  const datos: Dato[] = [];
  const declaran = new Map<string, number>();
  const nombresUsados = new Set<string>();
  const declara = c.declaracion;
  const definidos = declara.tipo === "nombre-definido-en-la-fuente" ? nombresDeLaFuente(c, indice) : new Map<string, number>();
  const prefijoDeNombre = declara.tipo === "nombre-definido-en-la-fuente" ? declara.prefijoDeNombre : null;
  const visto = new Set<string>();
  const nuevo = (rol: string, ruta: string, desde: number): boolean => {
    const clave = `${rol}|${ruta}|${desde}`;
    if (visto.has(clave)) return false;
    visto.add(clave);
    return true;
  };

  for (const ruta of archivos) {
    const imp = declara.tipo === "importar-ancla" && esTs(ruta) && (c.fuente.ancla === "default" || indice.fuente(ruta).includes(c.fuente.ancla)) ? importaElAncla(indice.arbol(ruta), ruta, c.fuente.archivo, c.fuente.ancla) : null;
    let usos = 0;
    let primeroValido = -1;
    for (const s of c.senales) {
      for (const k of coincidenciasDe(s, ruta, indice, prefijoDeNombre)) {
        if (enElAncla(ruta, k.desde)) continue;
        usos++;
        nombresUsados.add(k.nombre);
        let declarado: boolean;
        if (declara.tipo === "importar-ancla") declarado = imp !== null;
        else if (declara.tipo === "clase-companera") declarado = k.companeras.includes(declara.clase) || declara.equivalentes.some((q) => k.companeras.includes(q));
        else declarado = definidos.has(k.nombre);
        if (declarado && primeroValido < 0) primeroValido = k.desde;
        if (declarado || !nuevo("uso", ruta, k.desde)) continue;
        const detalle = declara.tipo === "nombre-definido-en-la-fuente" ? `usa \`${k.nombre}\`, que la fuente no define` : `${s.que} sin declarar el contrato`;
        datos.push({ ruta, desde: k.desde, tipo: "uso-sin-declarar", que: detalle, como: comoDeclarar(c), fragmento: k.fragmento });
      }
    }
    // Una fuente CSS con nombres: dentro del ancla vale la PRIMERA definición de cada nombre; la segunda (en el ancla o fuera de ella) es un duplicado.
    const definidosEnElAncla = new Set<string>();
    const definiciones = c.definicion.flatMap((d) => coincidenciasDe(d, ruta, indice, prefijoDeNombre).map((k) => ({ d, k }))).sort((a, b) => a.k.desde - b.k.desde);
    for (const { d, k } of definiciones) {
      let que = `${d.que} fuera de la fuente «${c.fuente.archivo}»`;
      if (enElAncla(ruta, k.desde)) {
        const nombre = k.nombre || k.fragmento;
        if (declara.tipo !== "nombre-definido-en-la-fuente" || !definidosEnElAncla.has(nombre)) {
          definidosEnElAncla.add(nombre);
          continue;
        }
        que = `${d.que}: \`${nombre}\` ya está definido antes en el ancla de la fuente «${c.fuente.archivo}»`;
      }
      if (!nuevo("definicion", ruta, k.desde)) continue;
      datos.push({ ruta, desde: k.desde, tipo: "definicion-duplicada", que, como: `usá la fuente (\`${c.fuente.ancla}\`) en vez de redefinirla`, fragmento: k.fragmento });
    }

    // Consumidor: el archivo que declara el contrato. Y una declaración sin ningún uso detrás sobra.
    if (declara.tipo === "importar-ancla") {
      if (imp) {
        declaran.set(ruta, imp.desde);
        if (!imp.usada && usos === 0) agregar("declaracion-sin-uso", ruta, imp.desde, `importa \`${c.fuente.ancla}\` y no lo usa ni usa nada que el contrato regule`, "sacá el import o usá la fuente");
      }
    } else if (declara.tipo === "clase-companera") {
      const reglasVisibles = esCss(ruta) ? indice.reglas(ruta).filter((r) => !enElAncla(ruta, r.desde)) : [];
      const donde = esCss(ruta) ? primeraReglaConClase(reglasVisibles, declara.clase) : primeraClase(indice.cadenas(ruta), declara.clase);
      if (donde !== null) {
        declaran.set(ruta, donde);
        if (usos === 0) agregar("declaracion-sin-uso", ruta, donde, `lleva la clase \`${declara.clase}\` y no tiene ningún uso que el contrato regule`, `sacá la clase \`${declara.clase}\` o agregá lo que la necesita`);
      }
    } else if (primeroValido >= 0) declaran.set(ruta, primeroValido);
  }

  // --- «nombre definido en la fuente»: un nombre definido que nadie usa también falla (en la fuente y en el alcance).
  if (declara.tipo === "nombre-definido-en-la-fuente") {
    const ruta = c.fuente.archivo;
    // Una fuente revisada como consumidor ya aportó sus usos (menos los del ancla); si no, todo lo que la fuente usa cuenta como uso.
    if (!fuenteRevisada) for (const s of c.senales) for (const k of coincidenciasDe(s, ruta, indice, prefijoDeNombre)) nombresUsados.add(k.nombre);
    for (const [nombre, desde] of definidos) {
      if (!nombresUsados.has(nombre)) agregar("declaracion-sin-uso", ruta, desde, `la fuente define \`${nombre}\` y nadie lo usa`, "usalo en un consumidor o sacalo de la fuente");
    }
  }

  // --- Los consumidores: descubiertos (al menos uno) o una lista cerrada en las dos direcciones.
  if (c.consumidores === "descubiertos") {
    if (declaran.size === 0) {
      agregar("consumidor-fantasma", c.fuente.archivo, 0, "ningún archivo del alcance declara el contrato: no tiene consumidores", `declaralo en quien lo usa (${comoDeclarar(c)}) o sacá el contrato`);
    }
  } else {
    if (c.consumidores.length === 0) agregar("consumidor-fantasma", c.fuente.archivo, 0, "la lista cerrada de consumidores está vacía", "listá los archivos que dependen del contrato o usá \"descubiertos\"");
    for (const ruta of c.consumidores) {
      if (!indice.tiene(ruta)) agregar("consumidor-fantasma", ruta, 0, `«${ruta}» figura como consumidor y no existe`, "sacalo de `consumidores`");
      else if (!enAlcance(c, ruta) || (ruta === c.fuente.archivo && !fuenteRevisada)) agregar("consumidor-fantasma", ruta, 0, `«${ruta}» figura como consumidor y está fuera del alcance del contrato`, "sacalo de `consumidores` o ampliá el alcance");
      else if (!declaran.has(ruta)) agregar("consumidor-fantasma", ruta, 0, `«${ruta}» figura como consumidor y no declara el contrato`, `${comoDeclarar(c)} o sacalo de \`consumidores\``);
    }
    for (const [ruta, desde] of declaran) {
      if (!c.consumidores.includes(ruta)) agregar("uso-sin-declarar", ruta, desde, "declara el contrato pero no figura en la lista cerrada `consumidores`", "agregalo a `consumidores` (la lista se revisa en las dos direcciones)");
    }
  }

  // --- Casos legítimos y excepciones (cubren todos los usos de ese archivo con ese fragmento) y deuda (una entrada por uso real); lo que sobra, falla.
  const casoUsado = new Set<number>();
  const exUsada = new Set<number>();
  const deudaUsada = new Set<number>();
  for (const dato of datos.sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : a.desde - b.desde))) {
    const f = colapsar(dato.fragmento);
    const k = c.casosLegitimos.findIndex((x) => x.archivo === dato.ruta && colapsar(x.fragmento) === f);
    if (k >= 0) {
      casoUsado.add(k);
      continue;
    }
    const e = c.excepciones.findIndex((x) => x.archivo === dato.ruta && colapsar(x.fragmento) === f);
    if (e >= 0) {
      exUsada.add(e);
      continue;
    }
    const d = c.deuda.findIndex((x, i) => !deudaUsada.has(i) && x.archivo === dato.ruta && colapsar(x.fragmento) === f);
    if (d >= 0) {
      deudaUsada.add(d);
      continue;
    }
    agregar(dato.tipo, dato.ruta, dato.desde, dato.que, dato.como, f);
  }
  c.casosLegitimos.forEach((k, i) => {
    if (!casoUsado.has(i)) agregar("caso-legitimo-sobrante", k.archivo, 0, `el caso legítimo de «${colapsar(k.fragmento)}» ya no corresponde a ningún uso`, "sacalo de `casosLegitimos` del contrato");
  });
  c.excepciones.forEach((e, i) => {
    if (!exUsada.has(i)) agregar("excepcion-sobrante", e.archivo, 0, `la excepción de «${colapsar(e.fragmento)}» ya no corresponde a ningún uso`, "sacala de `excepciones` del contrato");
  });
  c.deuda.forEach((d, i) => {
    if (!deudaUsada.has(i)) agregar("deuda-sobrante", d.archivo, 0, `la deuda de «${colapsar(d.fragmento)}» ya no corresponde a ningún uso real (o sobra una entrada repetida)`, "sacala de `deuda` del contrato: ya está pagada");
  });
  return hallazgos;
}

/** Los nombres que define la fuente (`--x`) con la posición de su primera definición. CSS: las propiedades personalizadas de la regla ANCLA (no las del resto del archivo); TS: todo `--x` escrito en el código. */
function nombresDeLaFuente(c: Contrato, indice: Indice): Map<string, number> {
  const ruta = c.fuente.archivo;
  if (esCss(ruta)) {
    const reglas = indice.reglas(ruta);
    const regla = reglaDelAncla(reglas, c.fuente.ancla);
    return regla === null ? new Map<string, number>() : variablesDefinidas(reglas, regla);
  }
  const nombres = new Map<string, number>();
  for (const m of indice.limpia(ruta).matchAll(/--[A-Za-z][\w-]*/g)) if (!nombres.has(m[0])) nombres.set(m[0], m.index);
  return nombres;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// El motor
// ---------------------------------------------------------------------------------------------------------------------------------

const comparar = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

export function revisarContratos(opciones: OpcionesDelMotor): Resultado {
  validarManifiesto(opciones.contratos);
  const indice = new Indice(opciones.raiz, listar(opciones.raiz, opciones.contratos));
  const marcas = leerMarcas(indice);
  const conocidos = new Set(opciones.contratos.map((c) => c.id));

  const hallazgos: Hallazgo[] = [];
  const avisos: Aviso[] = [];
  for (const m of marcas) {
    if (conocidos.has(m.id)) continue;
    hallazgos.push({
      contrato: m.id,
      tipo: "marca-desconocida",
      archivo: m.ruta,
      ...indice.posicion(m.ruta, m.desde),
      que: `la marca \`@contrato ${m.id}\` no es de ningún contrato del manifiesto`,
      como: "declarar el contrato en `manifiesto.ts` o sacar la marca",
      fragmento: "",
      fuente: "",
    });
  }
  for (const c of opciones.contratos) hallazgos.push(...revisarContrato(c, indice, marcas, opciones.hoy, avisos, opciones.raiz));

  const unicos = new Map<string, Hallazgo>();
  for (const h of hallazgos) unicos.set(`${h.archivo}|${h.linea}|${h.columna}|${h.contrato}|${h.tipo}|${h.que}`, h);
  const ordenados = [...unicos.values()].sort((a, b) => comparar(a.archivo, b.archivo) || a.linea - b.linea || a.columna - b.columna || comparar(a.contrato, b.contrato) || comparar(a.tipo, b.tipo) || comparar(a.que, b.que));

  const deudaPorContrato: Record<string, number> = {};
  const casosLegitimosPorContrato: Record<string, number> = {};
  for (const c of opciones.contratos) {
    if (c.deuda.length > 0) deudaPorContrato[c.id] = c.deuda.length;
    if (c.casosLegitimos.length > 0) casosLegitimosPorContrato[c.id] = c.casosLegitimos.length;
  }
  return {
    hallazgos: ordenados,
    avisos: avisos.sort((a, b) => comparar(a.tipo, b.tipo) || comparar(a.contrato, b.contrato) || comparar(a.archivo, b.archivo) || comparar(a.fragmento, b.fragmento)),
    resumen: {
      contratos: opciones.contratos.length,
      archivosLeidos: indice.leidos,
      deudaTotal: opciones.contratos.reduce((n, c) => n + c.deuda.length, 0),
      deudaPorContrato,
      excepcionesTotal: opciones.contratos.reduce((n, c) => n + c.excepciones.length, 0),
      casosLegitimosTotal: opciones.contratos.reduce((n, c) => n + c.casosLegitimos.length, 0),
      casosLegitimosPorContrato,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------------------------------------------------------------

/** Un hallazgo en el formato del reporte: `archivo:línea:columna  [contrato · tipo]`, qué falta → cómo se corrige, y la fuente con el fragmento para exceptuarlo. */
export function formatearHallazgo(h: Hallazgo): string {
  const lineas = [`${h.archivo}:${h.linea}:${h.columna}  [${h.contrato} · ${h.tipo}]`, `  ${h.que} → ${h.como}`];
  const cola = [h.fuente ? `fuente: ${h.fuente}` : "", h.fragmento ? `fragmento (para excepción o deuda): «${h.fragmento}»` : ""].filter(Boolean);
  if (cola.length > 0) lineas.push(`  ${cola.join(" · ")}`);
  return lineas.join("\n");
}

/** La línea de resumen del reporte: cuántos contratos, cuánta deuda (por contrato), cuántas excepciones y cuántos casos legítimos (por contrato). */
export function resumirContratos(resultado: Resultado): string {
  const r = resultado.resumen;
  const deuda = Object.entries(r.deudaPorContrato)
    .map(([id, n]) => `${id}: ${n}`)
    .join(", ");
  const casos = Object.entries(r.casosLegitimosPorContrato)
    .map(([id, n]) => `${id}: ${n}`)
    .join(", ");
  return `${r.contratos} contratos · ${r.archivosLeidos} archivos leídos · deuda declarada: ${r.deudaTotal} usos${deuda ? ` (${deuda})` : ""} · excepciones: ${r.excepcionesTotal} · casos legítimos: ${r.casosLegitimosTotal}${casos ? ` (${casos})` : ""}`;
}

/** Un aviso (no falla): lo que vence pronto, o una deuda renovada demasiadas veces. */
export function formatearAviso(a: Aviso): string {
  const que = `aviso: [${a.contrato}] ${a.clase === "deuda" ? "la deuda" : "la excepción"} de «${a.fragmento}» en ${a.archivo}`;
  if (a.tipo === "muchas-renovaciones") return `${que} ya se renovó ${a.renovaciones} veces: pagala en vez de renovarla otra vez`;
  return `${que} ${a.dias === 0 ? "vence hoy" : `vence en ${a.dias} ${a.dias === 1 ? "día" : "días"} (${a.vence})`}`;
}

export function formatearReporte(resultado: Resultado): string {
  return [...resultado.hallazgos.map(formatearHallazgo), ...resultado.avisos.map(formatearAviso), resumirContratos(resultado)].join("\n");
}
