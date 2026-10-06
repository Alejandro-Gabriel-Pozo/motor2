import type { Resultado } from "./validaciones";

/**
 * Alcance multisucursal de la carta (Fase A de multi-tenancy, `Downloads/Motor 2/plan-panel-gerenciamiento-empresa-sucursal-2026-09-27.md`,
 * sección 2.4): `SeccionCarta`/`ItemAgrupadoCarta` pasan de ser 100% globales a poder acotarse a un subconjunto de sucursales de la
 * empresa. PURO — sin Prisma: los `sucursalIds` de acá son SIEMPRE resueltos por quien llama (leyendo la tabla puente
 * correspondiente, `SeccionCartaSucursal`/`ItemAgrupadoCartaSucursal`, que TODAVÍA NO EXISTEN en `prisma/schema.prisma` real —
 * solo en el schema experimental `prisma/fase-a/schema.prisma`, ver ADR-004). Este archivo no depende de que esas tablas existan:
 * documenta y prueba la REGLA, para que el día que se conecte al schema real sea "enchufar", no "diseñar de nuevo".
 */
export type AlcanceCarta = "TODAS" | "SUCURSALES";

/**
 * C1: una sección/ítem con `alcance=TODAS` se ve en cualquier sucursal (incluidas las que se creen después); con
 * `alcance=SUCURSALES` solo en las que están en su tabla puente.
 */
export function seVeEnSucursal(alcance: AlcanceCarta, sucursalIds: readonly string[], sucursalId: string): boolean {
  return alcance === "TODAS" || sucursalIds.includes(sucursalId);
}

/**
 * C1/C2: "un ítem agrupado no puede tener alcance más amplio que su sección" — si no, quedaría invisible (la sección lo tapa)
 * o inconsistente. `TODAS` es "más amplio" que cualquier `SUCURSALES`; un ítem `SUCURSALES` es válido bajo una sección `TODAS`
 * (la sección ya cubre cualquier sucursal, así que cualquier subconjunto del ítem cae adentro).
 */
export function validarAlcanceItemDentroDeSeccion(
  seccion: { alcance: AlcanceCarta; sucursalIds: readonly string[] },
  item: { alcance: AlcanceCarta; sucursalIds: readonly string[] }
): Resultado<true> {
  if (seccion.alcance === "TODAS") return { ok: true, valor: true };
  if (item.alcance === "TODAS") {
    return { ok: false, mensaje: "El ítem no puede tener alcance TODAS si su sección solo se ve en sucursales puntuales." };
  }
  const fueraDeLaSeccion = item.sucursalIds.filter((id) => !seccion.sucursalIds.includes(id));
  if (fueraDeLaSeccion.length > 0) {
    return {
      ok: false,
      mensaje: `El ítem se ve en sucursales donde su sección no se ve (${fueraDeLaSeccion.length}). Ampliá primero el alcance de la sección.`,
    };
  }
  return { ok: true, valor: true };
}

/**
 * C6: achicar el alcance de una sección/ítem/promo no puede dejarlo sin ninguna sucursal — para ocultarlo de todas se apaga
 * `activa`/`activo`, nunca queda una fila `SUCURSALES` con la lista vacía (ambiguo: ¿"en ninguna" o "todavía sin configurar"?).
 */
export function validarNoAlcanceVacio(sucursalIdsNuevo: readonly string[]): Resultado<true> {
  if (sucursalIdsNuevo.length === 0) {
    return { ok: false, mensaje: "El alcance no puede quedar sin ninguna sucursal: para ocultarlo de todas, apagalo en vez de achicar el alcance." };
  }
  return { ok: true, valor: true };
}

/** Diff puro para C5 (ampliar)/C6 (achicar)/C7 (TODAS⇄SUCURSALES): qué sucursales se suman y cuáles se sacan. */
export function diferenciaDeAlcance(
  actuales: readonly string[],
  nuevas: readonly string[]
): { agregadas: string[]; quitadas: string[] } {
  const actualesSet = new Set(actuales);
  const nuevasSet = new Set(nuevas);
  return {
    agregadas: nuevas.filter((id) => !actualesSet.has(id)),
    quitadas: actuales.filter((id) => !nuevasSet.has(id)),
  };
}
