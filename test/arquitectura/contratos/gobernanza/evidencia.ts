import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { listarArchivos } from "../../cercos/trinquete";
import { MANIFIESTO } from "../manifiesto";
import { formatearAviso, formatearHallazgo, revisarContratos } from "../motor";
import { PISO_DE_ARCHIVOS_LEIDOS, diasEntre } from "../politica";
import type { Contrato, Detector } from "../tipos";
import { APROBACIONES, formatearHallazgoDeAprobacion, huellasActuales, idsDeContratosAprobados, revisarAprobaciones, type Aprobacion } from "./aprobaciones";
import { ARCHIVO_DE_AREAS, AREAS, POLITICA_DE_TIPOS, compararAreas, formatearHallazgoDeArea, posicionEnTexto } from "./areas";
import { formatearHallazgoDeCumplimiento, revisarCumplimiento } from "./cumplimiento";
import { formatearHallazgoDeRuta, revisarClasificacionDelRepo, type TipoDeRuta } from "./clasificacion";
import { EXCLUSIONES, type Exclusion } from "./exclusiones";
import { usosDeContratos } from "./usos";

/**
 * La EVIDENCIA POR CORRIDA del guardián de contratos (paso G5, capa 11 del plan de gobernanza). Responde a lo que «verde» no dice: **«pasó» no es «no encontró nada»**. Un guardián que recorre cero
 * archivos, que perdió un contrato o cuyo alcance quedó vacío también termina sin hallazgos; la evidencia deja por escrito QUÉ corrió y QUÉ cubrió (commit, huella del mecanismo, por contrato los
 * archivos en alcance, los detectores y los consumidores, las áreas, los archivos por tipo, lo que vence, el cumplimiento, el registro de aprobaciones y la matriz de mutaciones) y FALLA si:
 *  - el conjunto de ids de contratos del manifiesto no es EXACTAMENTE el de los contratos aprobados en el registro (un manifiesto vaciado, un contrato perdido o sumado sin aprobar);
 *  - algún contrato tiene alcance de 0 archivos;
 *  - el motor leyó menos que el piso aprobado (`PISO_DE_ARCHIVOS_LEIDOS`, `politica.ts`);
 *  - hay CUALQUIER hallazgo (del motor, la clasificación, las áreas, el cumplimiento, el registro de aprobaciones) o la matriz de mutaciones tiene un hueco.
 *
 * Este módulo es PURO en lo que importa (las funciones de veredicto reciben datos y devuelven problemas) y sin Vitest: lo usa el ejecutor `ejecutar.ts` (camino B del guardián, con `tsx`, encadenado en
 * `npm run arquitectura`) y el arnés de mutaciones (la matriz demuestra que una evidencia vacía se detecta).
 */

export const TIPOS_DE_PROBLEMA_DE_EVIDENCIA = ["ids-distintos-del-aprobado", "alcance-cero", "archivos-bajo-el-piso", "hallazgos", "matriz-con-huecos"] as const;
export type TipoDeProblemaDeEvidencia = (typeof TIPOS_DE_PROBLEMA_DE_EVIDENCIA)[number];

const CARPETA = "test/arquitectura/contratos";

export interface ProblemaDeEvidencia {
  tipo: TipoDeProblemaDeEvidencia;
  /** Dónde se corrige: el manifiesto, la definición del contrato, `politica.ts` o, para el resto, el ejecutor. */
  archivo: string;
  /** El contrato al que se refiere (vacío si no es de uno). */
  sujeto: string;
  que: string;
  como: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// El veredicto estructural: «pasó» contra «no encontró nada»
// ---------------------------------------------------------------------------------------------------------------------------------

export interface EntradaEstructural {
  /** Los ids del manifiesto en uso. */
  ids: readonly string[];
  /** Los ids de contratos con una aprobación vigente en el registro. */
  aprobados: readonly string[];
  /** Cuántos archivos tiene en su alcance cada contrato del manifiesto. */
  alcances: readonly { id: string; raices: readonly string[]; archivos: number }[];
  /** `Resumen.archivosLeidos` del motor. */
  archivosLeidos: number;
  /** El piso aprobado (`PISO_DE_ARCHIVOS_LEIDOS`). */
  piso: number;
}

const lista = (ids: readonly string[]): string => (ids.length === 0 ? "ninguno" : ids.map((i) => `«${i}»`).join(", "));

/** Los tres controles que distinguen un guardián que corrió de uno que corrió en vacío. Función pura. */
export function problemasEstructurales(e: EntradaEstructural): ProblemaDeEvidencia[] {
  const problemas: ProblemaDeEvidencia[] = [];
  const faltan = e.aprobados.filter((id) => !e.ids.includes(id));
  const sobran = e.ids.filter((id) => !e.aprobados.includes(id));
  if (e.ids.length === 0) {
    problemas.push({
      tipo: "ids-distintos-del-aprobado",
      archivo: `${CARPETA}/manifiesto.ts`,
      sujeto: "",
      que: `el manifiesto no tiene ningún contrato (aprobados: ${lista(e.aprobados)}): el guardián pasaría en vacío`,
      como: "restaurá los contratos en `manifiesto.ts`",
    });
  } else if (faltan.length > 0 || sobran.length > 0) {
    problemas.push({
      tipo: "ids-distintos-del-aprobado",
      archivo: `${CARPETA}/manifiesto.ts`,
      sujeto: "",
      que: `el conjunto de contratos del manifiesto no es el aprobado en el registro: faltan ${lista(faltan)}; sobran ${lista(sobran)}`,
      como: "restaurá el contrato que falta en `manifiesto.ts`, o registrá la aprobación del que se agrega o se retira en `APROBACIONES` (`gobernanza/aprobaciones.ts`)",
    });
  }
  for (const a of e.alcances) {
    if (a.archivos === 0) {
      problemas.push({
        tipo: "alcance-cero",
        archivo: `${CARPETA}/contratos/${a.id}.ts`,
        sujeto: a.id,
        que: `el contrato «${a.id}» no tiene ningún archivo en su alcance (${a.raices.join(", ")}): pasaría sin mirar nada`,
        como: "corregí las raíces o las extensiones del alcance del contrato, o restaurá la carpeta que se movió",
      });
    }
  }
  if (e.archivosLeidos < e.piso) {
    problemas.push({
      tipo: "archivos-bajo-el-piso",
      archivo: `${CARPETA}/politica.ts`,
      sujeto: "",
      que: `el motor leyó ${e.archivosLeidos} archivos y el piso aprobado es ${e.piso} (\`PISO_DE_ARCHIVOS_LEIDOS\` de \`politica.ts\`): el recorrido no está mirando el repo entero`,
      como: "revisá qué carpeta dejó de recorrerse (un alcance, una raíz de marcas, una extensión); el piso solo se baja con una aprobación en el registro",
    });
  }
  return problemas;
}

/** Los archivos del alcance de un contrato tal como los lista el motor: las carpetas de `raices` recorridas con las extensiones del alcance, más los archivos sueltos que cumplen una extensión. */
export function archivosEnAlcance(raiz: string, c: Contrato): string[] {
  const carpetas: string[] = [];
  const sueltos: string[] = [];
  for (const r of c.alcance.raices) {
    const absoluta = join(raiz, ...r.split("/"));
    if (!existsSync(absoluta)) continue;
    (statSync(absoluta).isDirectory() ? carpetas : sueltos).push(r);
  }
  const salida = new Set(listarArchivos(raiz, carpetas, c.alcance.extensiones));
  for (const s of sueltos) if (c.alcance.extensiones.some((x) => s.endsWith(x))) salida.add(s);
  return [...salida].sort();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La evidencia
// ---------------------------------------------------------------------------------------------------------------------------------

export interface EvidenciaDeContrato {
  id: string;
  fuente: string;
  raices: readonly string[];
  /** Cuántos archivos tiene en su alcance y el sha1 de esa lista (ordenada, uno por línea): cambia si entra o sale cualquiera. */
  archivosEnAlcance: number;
  shaDeLaLista: string;
  /** Los detectores que corrieron: de uso (`senales`) y de redefinición (`definicion`), con su frase del reporte. */
  detectores: { senales: readonly string[]; definicion: readonly string[] };
  /** Los archivos del alcance que declaran el contrato, y cuántos tienen lo que regula (declarado o no). */
  consumidores: { modo: "descubiertos" | "lista"; cantidad: number; archivos: readonly string[] };
  archivosConUso: number;
  hallazgos: number;
  casosLegitimos: number;
  excepciones: number;
  deuda: number;
}

/** Una excepción, una deuda o una exclusión con los días que faltan para que venza (negativo = vencida). */
export interface Vencimiento {
  clase: "excepcion" | "deuda" | "exclusion";
  /** El id del contrato, o `clasificacion` para una exclusión. */
  de: string;
  archivo: string;
  fragmento: string;
  vence: string;
  dias: number;
}

export interface ResumenDeMatriz {
  invariantes: number;
  mutaciones: number;
  /** Cuántas mutaciones se aplicaron de verdad (sin contar las que no aplican). */
  corridas: number;
  protegidas: number;
  huecosConocidos: number;
  noAplican: number;
  /** Las que sobrevivieron o rompieron el aislamiento (`HUECO`, `hueco-ya-protegido`, `error-del-operador`, `aislamiento-roto`). */
  fallan: number;
  segundos: number;
  /** La tabla del arnés (invariante · clase · elemento · mutación · esperado · real · veredicto), la misma de `tablaComoJson`. */
  tabla: readonly Record<string, unknown>[];
  /** Solo las filas que fallan, en texto. */
  fallas: string;
}

export interface Evidencia {
  version: 1;
  /** `AAAA-MM-DD` (UTC) con el que se evaluaron los vencimientos, y el instante de la corrida. */
  hoy: string;
  generada: string;
  commit: string;
  /** `false` si hay cambios sin commitear: el commit no describe lo que corrió. */
  arbolSinCambios: boolean;
  /** sha1 de las huellas de todas las piezas del mecanismo (`huellasActuales`): cambia si cambia cualquiera. */
  huellaDelMecanismo: string;
  piezasDelMecanismo: number;
  idsDelManifiesto: readonly string[];
  idsAprobados: readonly string[];
  contratos: readonly EvidenciaDeContrato[];
  archivosLeidos: number;
  pisoDeArchivosLeidos: number;
  areas: { total: number; conVacio: number; conContratos: number; archivosDeTiposQueNoDeclaran: Readonly<Record<string, number>> };
  archivosPorTipo: Readonly<Record<string, number>>;
  archivosTotales: number;
  sinClasificar: number;
  excluidos: number;
  /** Excepciones, deuda y exclusiones, de la que vence antes a la que vence después. */
  vencimientos: readonly Vencimiento[];
  avisos: readonly string[];
  cumplimiento: { testsProtegidos: number; hallazgos: number };
  aprobaciones: { piezas: number; entradas: number; hallazgos: number };
  matriz: ResumenDeMatriz | null;
  /** Cada hallazgo, en el formato del reporte de su mecanismo. */
  hallazgos: readonly string[];
  problemas: readonly ProblemaDeEvidencia[];
  /** `ok` solo si no hay ningún problema. */
  veredicto: "ok" | "falla";
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;
const sha1 = (texto: string): string => createHash("sha1").update(texto).digest("hex");

function descripcionDeDetector(d: Detector): string {
  const tecnica = d.adaptador === "clases" ? "clases" : `${d.adaptador}/${d.tipo}`;
  return `${tecnica}: ${d.que}`;
}

function git(raiz: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", raiz, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export interface OpcionesDeEvidencia {
  /** La raíz del repo (o de una copia exacta). */
  raiz: string;
  /** El manifiesto en uso (por defecto, el real). */
  contratos?: readonly Contrato[];
  /** Las exclusiones en uso (por defecto, las reales). */
  exclusiones?: readonly Exclusion[];
  /** El registro de aprobaciones en uso (por defecto, el real). */
  registro?: readonly Aprobacion[];
  /** `AAAA-MM-DD`: el día con el que se evalúan los vencimientos (lo inyecta quien llama; el ejecutor real, `fechaUtcDeHoy()`). */
  hoy: string;
  /** El piso de archivos leídos (por defecto, el aprobado). */
  piso?: number;
  /** El resumen de la matriz de mutaciones, si se corrió (el ejecutor la corre; los tests de este módulo, no). */
  matriz?: ResumenDeMatriz | null;
}

/** Corre el motor, la clasificación, las áreas, el cumplimiento y el registro de aprobaciones sobre el árbol de `raiz` y arma la evidencia con su veredicto. */
export function armarEvidencia(o: OpcionesDeEvidencia): Evidencia {
  const contratos = o.contratos ?? MANIFIESTO;
  const exclusiones = o.exclusiones ?? EXCLUSIONES;
  const registro = o.registro ?? APROBACIONES;
  const piso = o.piso ?? PISO_DE_ARCHIVOS_LEIDOS;
  const matriz = o.matriz ?? null;

  const motor = revisarContratos({ raiz: o.raiz, contratos, hoy: o.hoy });
  const clasificacion = revisarClasificacionDelRepo(o.raiz, o.hoy);
  const usos = usosDeContratos(o.raiz, contratos);
  const textoDeAreas = readFileSync(join(o.raiz, ...ARCHIVO_DE_AREAS.split("/")), "utf8");
  const areas = compararAreas({ tipos: clasificacion.tipos, declaraciones: AREAS, usos, posicionDeEntrada: (a) => posicionEnTexto(textoDeAreas, a) });
  const cumplimiento = revisarCumplimiento(o.raiz, { contratos, registro });
  const aprobaciones = revisarAprobaciones({ raiz: o.raiz, contratos, exclusiones, politicaDeTipos: POLITICA_DE_TIPOS, registro });
  const huellas = huellasActuales({ raiz: o.raiz, contratos, exclusiones, politicaDeTipos: POLITICA_DE_TIPOS });

  const delContrato: EvidenciaDeContrato[] = contratos.map((c) => {
    const alcance = archivosEnAlcance(o.raiz, c);
    const uso = usos.find((u) => u.id === c.id);
    const declaran = (uso?.archivos ?? []).filter((a) => a.declara).map((a) => a.ruta);
    return {
      id: c.id,
      fuente: `${c.fuente.archivo} · ${c.fuente.ancla}`,
      raices: c.alcance.raices,
      archivosEnAlcance: alcance.length,
      shaDeLaLista: sha1(alcance.join("\n")),
      detectores: { senales: c.senales.map(descripcionDeDetector), definicion: c.definicion.map(descripcionDeDetector) },
      consumidores: { modo: c.consumidores === "descubiertos" ? "descubiertos" : "lista", cantidad: declaran.length, archivos: declaran },
      archivosConUso: uso?.archivos.length ?? 0,
      hallazgos: motor.hallazgos.filter((h) => h.contrato === c.id).length,
      casosLegitimos: c.casosLegitimos.length,
      excepciones: c.excepciones.length,
      deuda: c.deuda.length,
    };
  });

  const vencimientos: Vencimiento[] = [
    ...contratos.flatMap((c) => c.excepciones.map((e) => ({ clase: "excepcion" as const, de: c.id, archivo: e.archivo, fragmento: e.fragmento, vence: e.vence, dias: diasEntre(o.hoy, e.vence) }))),
    ...contratos.flatMap((c) => c.deuda.map((d) => ({ clase: "deuda" as const, de: c.id, archivo: d.archivo, fragmento: d.fragmento, vence: d.vence, dias: diasEntre(o.hoy, d.vence) }))),
    ...exclusiones.map((e) => ({ clase: "exclusion" as const, de: "clasificacion", archivo: e.ruta, fragmento: `${e.archivos} archivos`, vence: e.vence, dias: diasEntre(o.hoy, e.vence) })),
  ].sort((a, b) => a.dias - b.dias || (a.archivo < b.archivo ? -1 : a.archivo > b.archivo ? 1 : 0));

  const ids = contratos.map((c) => c.id).sort();
  const aprobados = idsDeContratosAprobados(registro);
  const hallazgos = [
    ...motor.hallazgos.map(formatearHallazgo),
    ...clasificacion.hallazgos.map(formatearHallazgoDeRuta),
    ...areas.hallazgos.map(formatearHallazgoDeArea),
    ...cumplimiento.hallazgos.map(formatearHallazgoDeCumplimiento),
    ...aprobaciones.hallazgos.map(formatearHallazgoDeAprobacion),
  ];

  const problemas = problemasEstructurales({
    ids,
    aprobados,
    alcances: delContrato.map((c) => ({ id: c.id, raices: c.raices, archivos: c.archivosEnAlcance })),
    archivosLeidos: motor.resumen.archivosLeidos,
    piso,
  });
  if (hallazgos.length > 0) {
    problemas.push({ tipo: "hallazgos", archivo: `${CARPETA}/ejecutar.ts`, sujeto: "", que: `hay ${hallazgos.length} hallazgo${hallazgos.length === 1 ? "" : "s"} (motor ${motor.hallazgos.length}, clasificación ${clasificacion.hallazgos.length}, áreas ${areas.hallazgos.length}, cumplimiento ${cumplimiento.hallazgos.length}, aprobaciones ${aprobaciones.hallazgos.length})`, como: "corregí cada uno (están listados arriba, con archivo, línea y corrección)" });
  }
  if (matriz !== null && matriz.fallan > 0) {
    problemas.push({ tipo: "matriz-con-huecos", archivo: `${CARPETA}/ejecutar.ts`, sujeto: "", que: `la matriz de mutaciones tiene ${plural(matriz.fallan, "mutación", "mutaciones")} que el guardián no protege (HUECO)`, como: "arreglá el guardián o el operador de la mutación; el detalle está en la matriz de la evidencia" });
  }

  const avisos = [...motor.avisos.map(formatearAviso), ...clasificacion.avisos];
  const sinDeclarar: Record<string, number> = {};
  for (const [tipo, n] of Object.entries(areas.sinDeclarar)) sinDeclarar[tipo] = n;
  const archivosPorTipo: Record<string, number> = {};
  for (const [tipo, n] of Object.entries(clasificacion.porTipo as Record<TipoDeRuta, number>)) if (n > 0) archivosPorTipo[tipo] = n;

  return {
    version: 1,
    hoy: o.hoy,
    generada: new Date().toISOString(),
    commit: git(o.raiz, ["rev-parse", "HEAD"]) ?? "desconocido",
    arbolSinCambios: git(o.raiz, ["status", "--porcelain"]) === "",
    huellaDelMecanismo: sha1([...huellas].map(([clave, h]) => `${clave}=${h.huella}`).join("\n")),
    piezasDelMecanismo: huellas.size,
    idsDelManifiesto: ids,
    idsAprobados: aprobados,
    contratos: delContrato,
    archivosLeidos: motor.resumen.archivosLeidos,
    pisoDeArchivosLeidos: piso,
    areas: { total: areas.areas.length, conVacio: areas.conVacio, conContratos: areas.conLista, archivosDeTiposQueNoDeclaran: sinDeclarar },
    archivosPorTipo,
    archivosTotales: clasificacion.total,
    sinClasificar: clasificacion.hallazgos.filter((h) => h.tipo === "ruta-sin-clasificar").length,
    excluidos: clasificacion.excluidos,
    vencimientos,
    avisos,
    cumplimiento: { testsProtegidos: cumplimiento.protegidos.length, hallazgos: cumplimiento.hallazgos.length },
    aprobaciones: { piezas: aprobaciones.piezas, entradas: aprobaciones.entradas, hallazgos: aprobaciones.hallazgos.length },
    matriz,
    hallazgos,
    problemas,
    veredicto: problemas.length === 0 ? "ok" : "falla",
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// La matriz de mutaciones, resumida
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lo que la evidencia necesita de una corrida del arnés de mutaciones (`ejecutarMatriz`), sin importar `arnes.ts`. */
export interface CorridaDeMatriz {
  matriz: { invariantes: readonly unknown[] };
  filas: readonly { veredicto: string }[];
  corridas: number;
  milisegundos: number;
}

/** Resume una corrida del arnés: `tabla` es `tablaComoJson` ya leída, `fallas` el texto de `tablaComoTexto(filas, true)`, y `fallan` cuántas filas son una falla (`falla` del arnés). */
export function resumirMatriz(r: CorridaDeMatriz, tabla: readonly Record<string, unknown>[], fallas: string, fallan: number): ResumenDeMatriz {
  const por = (v: string): number => r.filas.filter((f) => f.veredicto === v).length;
  return { invariantes: r.matriz.invariantes.length, mutaciones: r.filas.length, corridas: r.corridas, protegidas: por("protegido"), huecosConocidos: por("hueco-conocido-confirmado"), noAplican: por("no-aplica"), fallan, segundos: Math.round(r.milisegundos / 100) / 10, tabla, fallas };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lectura humana
// ---------------------------------------------------------------------------------------------------------------------------------

const corto = (sha: string): string => sha.slice(0, 10);

function frasesDeVencimiento(v: readonly Vencimiento[]): string {
  const por = (clase: Vencimiento["clase"]): readonly Vencimiento[] => v.filter((x) => x.clase === clase);
  const cuanto = (xs: readonly Vencimiento[]): string => (xs.length === 0 ? "" : ` (la primera en ${xs[0].dias} días, ${xs[0].vence})`);
  return `excepciones ${por("excepcion").length}${cuanto(por("excepcion"))} · deuda ${por("deuda").length}${cuanto(por("deuda"))} · exclusiones ${por("exclusion").length}${cuanto(por("exclusion"))}`;
}

/** El resumen legible de la corrida (consola): una línea por cosa, y al final el veredicto con lo que falla. */
export function textoDeEvidencia(e: Evidencia): string {
  const l: string[] = [];
  l.push(`Evidencia de contratos · commit ${e.commit.slice(0, 12)}${e.arbolSinCambios ? "" : " (con cambios sin commitear)"} · hoy ${e.hoy} · huella del mecanismo ${corto(e.huellaDelMecanismo)} (${e.piezasDelMecanismo} piezas)`);
  l.push(`Contratos: ${e.contratos.length} (${e.idsDelManifiesto.join(", ") || "ninguno"}) · aprobados: ${e.idsAprobados.join(", ") || "ninguno"}`);
  for (const c of e.contratos) {
    l.push(`  ${c.id}: ${plural(c.archivosEnAlcance, "archivo", "archivos")} en alcance (lista ${corto(c.shaDeLaLista)}) · ${c.detectores.senales.length} detectores de uso y ${c.detectores.definicion.length} de redefinición · ${plural(c.consumidores.cantidad, "consumidor", "consumidores")} (${c.consumidores.modo}) · ${plural(c.hallazgos, "hallazgo", "hallazgos")}`);
  }
  l.push(`Archivos leídos por el motor: ${e.archivosLeidos} (piso aprobado ${e.pisoDeArchivosLeidos})`);
  l.push(`Áreas: ${e.areas.total} · ${e.areas.conVacio} declaran [] · ${e.areas.conContratos} declaran contratos`);
  l.push(`Archivos por tipo (${e.archivosTotales}): ${Object.entries(e.archivosPorTipo).map(([t, n]) => `${t} ${n}`).join(", ")} · sin clasificar: ${e.sinClasificar}`);
  l.push(`Vencimientos: ${frasesDeVencimiento(e.vencimientos)} · casos legítimos ${e.contratos.reduce((n, c) => n + c.casosLegitimos, 0)}`);
  l.push(`Avisos: ${e.avisos.length}${e.avisos.length > 0 ? `\n${e.avisos.map((a) => `  ${a}`).join("\n")}` : ""}`);
  l.push(`Cumplimiento del cableado: ${e.cumplimiento.testsProtegidos} tests protegidos · ${plural(e.cumplimiento.hallazgos, "hallazgo", "hallazgos")}`);
  l.push(`Registro de aprobaciones: ${e.aprobaciones.piezas} piezas vigiladas · ${e.aprobaciones.entradas} aprobaciones · ${plural(e.aprobaciones.hallazgos, "hallazgo", "hallazgos")}`);
  l.push(e.matriz === null ? "Matriz de mutaciones: no se corrió" : `Matriz de mutaciones: ${e.matriz.invariantes} invariantes · ${e.matriz.mutaciones} mutaciones · ${e.matriz.protegidas} protegidas · ${e.matriz.huecosConocidos} huecos conocidos · ${e.matriz.fallan} fallan · ${e.matriz.segundos} s`);
  if (e.hallazgos.length > 0) l.push("", ...e.hallazgos);
  if (e.matriz !== null && e.matriz.fallas !== "") l.push("", e.matriz.fallas);
  if (e.veredicto === "ok") {
    l.push(`RESULTADO: OK · ${e.contratos.length} contratos (el conjunto aprobado), todos con alcance > 0, ${e.archivosLeidos} archivos leídos (piso ${e.pisoDeArchivosLeidos}) y 0 hallazgos`);
  } else {
    l.push("", `RESULTADO: FALLA · ${plural(e.problemas.length, "problema", "problemas")}`);
    for (const p of e.problemas) l.push(`  [${p.tipo}] ${p.que} → ${p.como}`);
  }
  return l.join("\n");
}

/** El mismo resumen en Markdown, para `GITHUB_STEP_SUMMARY` (el resumen de la corrida en GitHub Actions). */
export function markdownDeEvidencia(e: Evidencia): string {
  const l: string[] = [];
  l.push(`## Contratos: evidencia por corrida · ${e.veredicto === "ok" ? "OK" : "FALLA"}`, "");
  l.push(`- **Commit** \`${e.commit.slice(0, 12)}\`${e.arbolSinCambios ? "" : " (con cambios sin commitear)"} · **hoy** ${e.hoy} · **huella del mecanismo** \`${corto(e.huellaDelMecanismo)}\` (${e.piezasDelMecanismo} piezas)`);
  l.push(`- **Archivos leídos por el motor** ${e.archivosLeidos} (piso aprobado ${e.pisoDeArchivosLeidos})`);
  l.push(`- **Áreas** ${e.areas.total}: ${e.areas.conVacio} declaran \`[]\`, ${e.areas.conContratos} declaran contratos`);
  l.push(`- **Archivos por tipo** (${e.archivosTotales}): ${Object.entries(e.archivosPorTipo).map(([t, n]) => `${t} ${n}`).join(", ")} · **sin clasificar: ${e.sinClasificar}**`);
  l.push(`- **Vencimientos**: ${frasesDeVencimiento(e.vencimientos)}`);
  l.push(`- **Cumplimiento del cableado**: ${e.cumplimiento.testsProtegidos} tests protegidos, ${e.cumplimiento.hallazgos} hallazgos · **Registro de aprobaciones**: ${e.aprobaciones.piezas} piezas, ${e.aprobaciones.entradas} aprobaciones, ${e.aprobaciones.hallazgos} hallazgos`);
  if (e.matriz !== null) l.push(`- **Matriz de mutaciones**: ${e.matriz.invariantes} invariantes, ${e.matriz.mutaciones} mutaciones, ${e.matriz.protegidas} protegidas, ${e.matriz.huecosConocidos} huecos conocidos, ${e.matriz.fallan} fallan (${e.matriz.segundos} s)`);
  l.push("", "| Contrato | Archivos en alcance | Lista (sha) | Detectores (uso / redefinición) | Consumidores | Hallazgos |", "|---|---:|---|---|---:|---:|");
  for (const c of e.contratos) l.push(`| \`${c.id}\` | ${c.archivosEnAlcance} | \`${corto(c.shaDeLaLista)}\` | ${c.detectores.senales.length} / ${c.detectores.definicion.length} | ${c.consumidores.cantidad} (${c.consumidores.modo}) | ${c.hallazgos} |`);
  const proximos = e.vencimientos.slice(0, 5);
  if (proximos.length > 0) {
    l.push("", "Próximos vencimientos:", "", "| Clase | De | Archivo | Vence | Días |", "|---|---|---|---|---:|");
    for (const v of proximos) l.push(`| ${v.clase} | \`${v.de}\` | \`${v.archivo}\` | ${v.vence} | ${v.dias} |`);
  }
  if (e.avisos.length > 0) l.push("", `Avisos (${e.avisos.length}):`, "", ...e.avisos.map((a) => `- ${a}`));
  if (e.problemas.length > 0) {
    l.push("", "### Problemas", "", ...e.problemas.map((p) => `- **${p.tipo}**: ${p.que} → ${p.como}`));
    if (e.hallazgos.length > 0) l.push("", "<details><summary>Hallazgos</summary>", "", "```", ...e.hallazgos, "```", "", "</details>");
    if (e.matriz !== null && e.matriz.fallas !== "") l.push("", "```", e.matriz.fallas, "```");
  }
  return `${l.join("\n")}\n`;
}
