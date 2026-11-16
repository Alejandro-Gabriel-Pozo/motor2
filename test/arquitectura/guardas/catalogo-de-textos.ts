import { huecosDe } from "@/core/textos/texto-de";
import { parsearRegistro } from "./registro-de-decisiones";

/**
 * Reglas del catálogo de textos de interfaz (diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, tramo T1; invariantes IT-1, IT-3, IT-4 y IT-8 SOLO sobre las entradas del propio catálogo).
 * Módulo PURO: recibe el catálogo, el texto del registro de decisiones y una función que lee archivos, para que el test ejerza cada regla con entradas inyectadas.
 *
 * Reglas (las revisa `catalogo-de-textos.test.ts`):
 *  - C1 la clave está bien formada (`rechazo.<CODIGO>` o `rotulo|accion|aviso|ayuda|titulo.<tema>`) y no hay dos claves que solo difieran en mayúsculas.
 *  - C2 el mismo valor (sin mayúsculas, tildes ni signos) bajo dos claves falla, salvo `homonimoDe` con motivo hacia una clave que existe y dice lo mismo.
 *  - C3 todo texto declara al menos un uso; cada uso nombra un archivo que existe, una función o constante que ese archivo declara y cita la clave.
 *  - C4 la fuente es `HEREDADO` (solo si la clave está en la línea base, que solo baja) o una DEC que existe en el registro y está ACEPTADA o CORREGIDA.
 *  - C5 los marcadores declarados son exactamente los huecos `{nombre}` del texto, de un tipo válido, sin llaves sueltas.
 * LÍMITES (honestos): C3 mira que el archivo declare el nombre y cite la clave en CUALQUIER parte; que la cita esté dentro de ESA función, que un uso no declarado aparezca o que una pantalla escriba el
 * texto a mano son tramos posteriores (T2 y T3). No comprueba que la redacción sea la aprobada (T5, oráculo IT-7). Es una alarma para errores honestos, no un límite de seguridad.
 */
export interface EntradaDelCatalogo {
  readonly porDefecto: string;
  readonly marcadores?: Readonly<Record<string, string>>;
  readonly usos: readonly { readonly archivo: string; readonly nombre: string }[];
  readonly fuente: { readonly decision: string } | "HEREDADO";
  readonly homonimoDe?: { readonly clave: string; readonly motivo: string };
}

export interface ContextoDelCatalogo {
  /** Texto de `docs/registro-de-decisiones.md`. */
  readonly registro: string;
  /** Contenido de un archivo del repo, o `null` si no existe. */
  readonly leerArchivo: (ruta: string) => string | null;
  /** Línea base de `HEREDADO`: claves que ya estaban antes del catálogo. Solo baja: una clave nueva no se agrega acá. */
  readonly heredados: readonly string[];
}

const FORMA_DE_CLAVE = /^(?:rechazo\.[A-Z][A-Z0-9_]*|(?:rotulo|accion|aviso|ayuda|titulo)\.[a-z][a-z0-9_]*)$/;
const TIPOS_DE_MARCADOR = ["texto", "causa", "entidad"] as const;
const ESTADOS_QUE_AUTORIZAN = ["ACEPTADA", "CORREGIDA"];
const LARGO_MINIMO_DEL_MOTIVO = 10;

/** Mismo valor a efectos de IT-1: minúsculas, sin tildes, sin signos ni espacios de más. */
export function normalizarValor(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}{}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function declara(codigo: string, nombre: string): boolean {
  return new RegExp(`(?:function\\s+|(?:const|let|class)\\s+)${escapar(nombre)}\\b`).test(codigo);
}

export function revisarCatalogo(catalogo: Readonly<Record<string, EntradaDelCatalogo>>, contexto: ContextoDelCatalogo): string[] {
  const problemas: string[] = [];
  const falla = (clave: string, que: string) => problemas.push(`${clave}: ${que}`);
  const claves = Object.keys(catalogo);
  const registro = parsearRegistro(contexto.registro);

  // C1
  const porMinusculas = new Map<string, string>();
  for (const clave of claves) {
    if (!FORMA_DE_CLAVE.test(clave)) falla(clave, "la clave no tiene la forma `rechazo.<CODIGO>` ni `rotulo|accion|aviso|ayuda|titulo.<tema>` (C1).");
    const otra = porMinusculas.get(clave.toLowerCase());
    if (otra !== undefined) falla(clave, `la clave solo difiere en mayúsculas de «${otra}» (C1).`);
    else porMinusculas.set(clave.toLowerCase(), clave);
  }

  // C2
  const porValor = new Map<string, string[]>();
  for (const clave of claves) {
    const valor = normalizarValor(catalogo[clave]!.porDefecto);
    porValor.set(valor, [...(porValor.get(valor) ?? []), clave]);
  }
  for (const [, grupo] of porValor) {
    if (grupo.length < 2) continue;
    for (const clave of grupo) {
      const homonimo = catalogo[clave]!.homonimoDe;
      const otras = grupo.filter((c) => c !== clave);
      if (!homonimo) falla(clave, `dice lo mismo que ${otras.map((c) => `«${c}»`).join(", ")} y no declara \`homonimoDe\`: un texto = una sola cosa, unilos o explicá por qué se mantienen aparte (C2).`);
      else if (!otras.includes(homonimo.clave)) falla(clave, `\`homonimoDe\` apunta a «${homonimo.clave}», que no dice lo mismo (C2).`);
      else if (homonimo.motivo.trim().length < LARGO_MINIMO_DEL_MOTIVO) falla(clave, "`homonimoDe` no trae un motivo escrito (C2).");
    }
  }

  for (const clave of claves) {
    const e = catalogo[clave]!;

    // C3
    if (e.usos.length === 0) falla(clave, "no declara ningún uso: un texto sin consumidor se borra (C3).");
    const vistos = new Set<string>();
    for (const uso of e.usos) {
      const id = `${uso.archivo}#${uso.nombre}`;
      if (vistos.has(id)) falla(clave, `el uso ${id} está repetido (C3).`);
      vistos.add(id);
      const codigo = contexto.leerArchivo(uso.archivo);
      if (codigo === null) falla(clave, `el uso nombra «${uso.archivo}», que no existe (C3).`);
      else {
        if (!declara(codigo, uso.nombre)) falla(clave, `el uso nombra «${uso.nombre}», que «${uso.archivo}» no declara (C3).`);
        if (!codigo.includes(`"${clave}"`) && !codigo.includes(`'${clave}'`)) falla(clave, `«${uso.archivo}» no cita la clave: ya no la usa (C3).`);
      }
    }

    // C4
    if (e.fuente === "HEREDADO") {
      if (!contexto.heredados.includes(clave)) falla(clave, "es `HEREDADO` pero no está en la línea base de heredados, que solo baja: un texto nuevo cita una DEC (C4).");
    } else if (typeof e.fuente !== "object" || e.fuente === null || typeof e.fuente.decision !== "string") {
      falla(clave, "la fuente no es `HEREDADO` ni `{ decision: \"DEC-NNNN\" }` (C4).");
    } else {
      const dec = registro.find((d) => d.id === (e.fuente as { decision: string }).decision);
      if (!dec) falla(clave, `la decisión «${e.fuente.decision}» no existe en docs/registro-de-decisiones.md (C4).`);
      else if (!ESTADOS_QUE_AUTORIZAN.includes(dec.campos["Estado"] ?? "")) falla(clave, `la decisión ${dec.id} está ${dec.campos["Estado"] ?? "sin estado"}: solo ${ESTADOS_QUE_AUTORIZAN.join(" o ")} autorizan un texto (C4).`);
    }

    // C5
    if (e.porDefecto.trim() === "" || e.porDefecto !== e.porDefecto.trim()) falla(clave, "el texto está vacío o tiene espacios al borde (C5).");
    const huecos = huecosDe(e.porDefecto);
    const declarados = Object.keys(e.marcadores ?? {});
    for (const h of huecos) if (!declarados.includes(h)) falla(clave, `el texto usa el hueco {${h}} y no lo declara en \`marcadores\` (C5).`);
    for (const d of declarados) if (!huecos.includes(d)) falla(clave, `declara el marcador «${d}» y el texto no lo usa (C5).`);
    for (const [nombre, tipo] of Object.entries(e.marcadores ?? {})) {
      if (!(TIPOS_DE_MARCADOR as readonly string[]).includes(tipo)) falla(clave, `el marcador «${nombre}» tiene un tipo que no existe: «${tipo}» (C5).`);
    }
    if (/[{}]/.test(e.porDefecto.replace(/\{[a-z][a-zA-Z0-9]*\}/g, ""))) falla(clave, "tiene una llave `{` o `}` suelta o un hueco mal escrito (el nombre va en minúscula inicial, sin espacios) (C5).");
  }
  return problemas;
}
