/**
 * Reglas de las descripciones de los permisos (F1' del catálogo de textos; `docs/diseno-textos-en-datos-2026-11-16.md`, familia D-1). `src/core/permisos/acciones.ts` (`ACCIONES[].descripcion`) es la LISTA ÚNICA
 * de esos textos: su dueño es el catálogo de permisos y su fuente es el dueño del negocio (las descripciones hablan de permisos). NO se copian al catálogo de textos (`src/core/textos/`): copiarlas las
 * escribiría tres veces y `acciones.ts` tiene que seguir sin importar `core/textos` (la carta pública alcanza ese archivo; `ALCANCE_CARTA_PUBLICA`). Módulo PURO: recibe las acciones y el oráculo.
 *
 * Reglas (las revisa `permisos-descripciones.test.ts`):
 *  - P1 toda acción tiene descripción, sin espacios al borde ni dobles: una sola cosa por texto y sin ruido.
 *  - P2 ninguna descripción se repite entre dos acciones (IT-1: un texto = una sola cosa).
 *  - P3 la descripción de cada acción es EXACTAMENTE la del oráculo; una acción nueva sin fila, o una fila sin acción, falla (IT-7: lo aprobado no cambia en silencio).
 * LÍMITES: no juzga si la redacción es buena, solo que es la aprobada y que no se duplica; no mira otros textos de permisos (los mensajes de `core/permisos/*.ts` son otra familia, D-2).
 */
export function revisarDescripcionesDePermisos(
  acciones: readonly { clave: string; descripcion: string }[],
  oraculo: Readonly<Record<string, string>>,
): string[] {
  const problemas: string[] = [];
  const porTexto = new Map<string, string[]>();
  for (const { clave, descripcion } of acciones) {
    if (typeof descripcion !== "string" || descripcion.trim() === "") problemas.push(`${clave}: no tiene descripción (P1).`);
    else if (descripcion !== descripcion.trim() || /\s{2,}/.test(descripcion)) problemas.push(`${clave}: la descripción tiene espacios al borde o dobles (P1).`);
    porTexto.set(descripcion, [...(porTexto.get(descripcion) ?? []), clave]);
    if (!(clave in oraculo)) problemas.push(`${clave}: es un permiso nuevo y su descripción no está en test/textos/oraculo-de-permisos.ts: agregala ahí tal cual (habla de permisos: la redacción la aprueba el dueño) (P3).`);
    else if (oraculo[clave] !== descripcion) problemas.push(`${clave}: la descripción cambió. Era «${oraculo[clave]}» y ahora dice «${descripcion}»: cambiar el texto de un permiso lo decide el dueño; si lo aprobó, actualizá el oráculo con su cita (P3).`);
  }
  for (const [texto, claves] of porTexto) if (claves.length > 1 && texto.trim() !== "") problemas.push(`${claves.join(", ")}: dicen lo mismo («${texto}»): un texto = una sola cosa (P2).`);
  const claves = new Set(acciones.map((a) => a.clave));
  for (const clave of Object.keys(oraculo)) if (!claves.has(clave)) problemas.push(`${clave}: está en el oráculo y ya no existe como permiso: sacá su fila (P3).`);
  return problemas;
}
