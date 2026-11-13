import { esFechaValida } from "../contratos/politica";

/**
 * Registro de decisiones de los agentes (regla «Lo que el dueño no pidió no entra», 2026-11-11, AGENTS.md; diseño `docs/diseno-aceptacion-del-dueno-2026-11-11.md`, etapa E2).
 *
 * Una DEC es una elección chica, reversible y necesaria para terminar lo pedido, que un agente tomó sin poder frenar y espera el OK del dueño. Vive en `docs/registro-de-decisiones.md`
 * (una sección `### DEC-NNNN` por decisión, un campo por renglón) y el código la cita con `DEC-NNNN`; un supuesto en el código solo existe como `SUPUESTO(DEC-NNNN)` (I4).
 * Este módulo es PURO (no lee disco: recibe el texto del registro, los archivos de código y una función `existeArchivo`), para que el test ejerza cada regla con entradas inyectadas.
 *
 * Reglas (las revisa `registro-de-decisiones.test.ts`):
 *  - Toda entrada tiene los campos, un id único con formato `DEC-NNNN` (4 dígitos: no se confunde con las decisiones del dueño `DEC-nn`), fecha real y un estado válido.
 *  - Toda entrada dice dónde está (`ruta` o `ruta:línea` entre comillas invertidas) y esa ruta existe.
 *  - `PENDIENTE_DE_OK` no lleva cita (no se presenta como definitiva); `ACEPTADA`, `CORREGIDA` y `REVOCADA` llevan la cita del dueño: «texto» — AAAA-MM-DD — fuente.
 *  - Como máximo 10 `PENDIENTE_DE_OK` (I6): con 10 abiertas no se agrega una nueva, se pregunta.
 *  - Todo `DEC-NNNN` que el código nombra existe en el registro, y ninguno nombra una `REVOCADA` (el cambio que la saca va en un PR propio).
 *  - Un `SUPUESTO` en el código sin `(DEC-NNNN)` falla.
 * Límite declarado: no detecta una decisión escrita sin la palabra (por ejemplo «asumimos»), ni que la cita sea realmente del dueño: solo que está y tiene forma.
 */
export const ESTADOS = ["PENDIENTE_DE_OK", "ACEPTADA", "CORREGIDA", "REVOCADA"] as const;

export const TOPE_DE_PENDIENTES = 10;
/** Largo mínimo de los campos de texto: una entrada con «-» o «…» no cuenta como escrita. */
const LARGO_MINIMO = 10;

const CAMPOS_DE_TEXTO = ["Quién", "Qué decidió", "Por qué", "Costo de revertir"] as const;
const FORMATO_DE_ID = /^DEC-\d{4}$/;
const FORMATO_DE_CITA = /^«([^»]+)»\s*—\s*(\d{4}-\d{2}-\d{2})\s*—\s*(\S.*)$/;

export interface Dec {
  id: string;
  campos: Record<string, string>;
}

/** Una `SUPUESTO` sin `(DEC-NNNN)` pegado. La palabra entera y en mayúsculas: «supuesto» en minúscula es prosa. */
const SUPUESTO_SIN_DEC = /\bSUPUESTO\b(?!\(DEC-\d{4}\))/g;
const MENCION_DE_DEC = /\bDEC-\d{4}\b/g;

/** Parte el registro en entradas: cada `### DEC-…` abre una y sus renglones `- **Campo:** valor` son sus campos. Lo que está antes de la primera es la introducción y no cuenta. */
export function parsearRegistro(texto: string): Dec[] {
  const entradas: Dec[] = [];
  let actual: Dec | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const titulo = /^### (\S+)\s*$/.exec(linea);
    if (titulo) {
      actual = { id: titulo[1], campos: {} };
      entradas.push(actual);
      continue;
    }
    if (/^#{1,3} /.test(linea)) {
      actual = null;
      continue;
    }
    const campo = /^- \*\*([^:*]+):\*\*\s*(.*)$/.exec(linea);
    if (campo && actual) {
      const nombre = campo[1].trim();
      // El primero gana: un campo repetido no pisa al anterior en silencio (el repetido se avisa abajo).
      if (nombre in actual.campos) actual.campos[`${nombre}#repetido`] = campo[2].trim();
      else actual.campos[nombre] = campo[2].trim();
    }
  }
  return entradas;
}

/** Las rutas que una entrada nombra en «Dónde»: lo que va entre comillas invertidas, sin el `:línea`. */
export function rutasDeDonde(valor: string): string[] {
  return [...valor.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].replace(/:\d+(?:-\d+)?$/, ""));
}

function problemasDeEntrada(dec: Dec, existeArchivo: (ruta: string) => boolean): string[] {
  const problemas: string[] = [];
  const falla = (que: string) => problemas.push(`${dec.id}: ${que}`);
  if (!FORMATO_DE_ID.test(dec.id)) falla("el título tiene que ser `DEC-NNNN` (cuatro dígitos).");
  for (const nombre of Object.keys(dec.campos)) if (nombre.endsWith("#repetido")) falla(`el campo «${nombre.replace("#repetido", "")}» está dos veces.`);

  const fecha = dec.campos["Fecha"];
  if (!fecha) falla("falta el campo «Fecha».");
  else if (!esFechaValida(fecha)) falla(`«Fecha» no es una fecha AAAA-MM-DD real (dice «${fecha}»).`);

  for (const nombre of CAMPOS_DE_TEXTO) {
    const valor = dec.campos[nombre];
    if (valor === undefined) falla(`falta el campo «${nombre}».`);
    else if (valor.length < LARGO_MINIMO) falla(`«${nombre}» está vacío o es muy corto (mínimo ${LARGO_MINIMO} caracteres).`);
  }

  const donde = dec.campos["Dónde"];
  if (donde === undefined) falla("falta el campo «Dónde» (archivo:línea).");
  else {
    const rutas = rutasDeDonde(donde);
    if (rutas.length === 0) falla("«Dónde» tiene que nombrar al menos un archivo entre comillas invertidas (`ruta` o `ruta:línea`).");
    for (const ruta of rutas) if (!existeArchivo(ruta)) falla(`«Dónde» nombra «${ruta}», que no existe en el repo.`);
  }

  const estado = dec.campos["Estado"];
  const cita = dec.campos["Cita del dueño"];
  if (estado === undefined) falla("falta el campo «Estado».");
  else if (!(ESTADOS as readonly string[]).includes(estado)) falla(`«Estado» tiene que ser uno de ${ESTADOS.join(", ")} (dice «${estado}»).`);
  else if (estado === "PENDIENTE_DE_OK") {
    if (cita !== undefined) falla("una decisión PENDIENTE_DE_OK no lleva «Cita del dueño»: todavía no hay aceptación y no se presenta como definitiva.");
  } else if (cita === undefined) falla(`una decisión ${estado} lleva «Cita del dueño»: «texto» — AAAA-MM-DD — fuente.`);
  else {
    const partes = FORMATO_DE_CITA.exec(cita);
    if (!partes) falla("«Cita del dueño» tiene que tener la forma «texto literal» — AAAA-MM-DD — fuente.");
    else if (!esFechaValida(partes[2])) falla(`«Cita del dueño» tiene una fecha que no es real (dice «${partes[2]}»).`);
  }
  return problemas;
}

/**
 * Revisa el registro contra el código. `codigo` es `ruta → texto` de los archivos escaneados (sin docs); `existeArchivo` dice si una ruta del repo existe.
 * Devuelve los problemas, uno por renglón y con el id o la ruta adelante, para que el rojo diga qué arreglar.
 */
export function revisarRegistro(registro: string, codigo: Readonly<Record<string, string>>, existeArchivo: (ruta: string) => boolean): string[] {
  const entradas = parsearRegistro(registro);
  const problemas: string[] = [];

  const vistos = new Set<string>();
  for (const dec of entradas) {
    if (vistos.has(dec.id)) problemas.push(`${dec.id}: el id está repetido en el registro.`);
    vistos.add(dec.id);
    problemas.push(...problemasDeEntrada(dec, existeArchivo));
  }

  const pendientes = entradas.filter((d) => d.campos["Estado"] === "PENDIENTE_DE_OK");
  if (pendientes.length > TOPE_DE_PENDIENTES) {
    problemas.push(`Hay ${pendientes.length} decisiones PENDIENTE_DE_OK y el tope es ${TOPE_DE_PENDIENTES} (I6): con ${TOPE_DE_PENDIENTES} abiertas no se agrega una nueva, se le pregunta al dueño.`);
  }

  const estadoDe = new Map(entradas.map((d) => [d.id, d.campos["Estado"]]));
  for (const [ruta, texto] of Object.entries(codigo)) {
    if (SUPUESTO_SIN_DEC.test(texto)) problemas.push(`${ruta}: dice SUPUESTO sin registrar (I4): escribilo como SUPUESTO(DEC-NNNN) y agregá la entrada a docs/registro-de-decisiones.md, o convertilo en una pregunta al dueño.`);
    SUPUESTO_SIN_DEC.lastIndex = 0;
    for (const id of new Set(texto.match(MENCION_DE_DEC) ?? [])) {
      if (!estadoDe.has(id)) problemas.push(`${ruta}: nombra ${id}, que no está en docs/registro-de-decisiones.md.`);
      else if (estadoDe.get(id) === "REVOCADA") problemas.push(`${ruta}: nombra ${id}, que el dueño REVOCÓ: el cambio que la saca va en un PR propio.`);
    }
  }
  return problemas;
}
