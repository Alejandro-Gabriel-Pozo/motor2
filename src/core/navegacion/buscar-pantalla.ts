import type { GrupoNav, RutaDeUnaEntrada } from "./estructura";

/** Minúsculas y sin acentos ni otras marcas combinadas: «Recetas», «recetas» y «RÉCETAS» son lo mismo para el buscador del menú. */
export function normalizarParaBuscar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export interface PantallaEncontrada {
  href: string;
  label: string;
  grupoId: string;
  grupoLabel: string;
}

/**
 * El buscador del menú de celular: las pantallas del menú (las que ya vienen filtradas por permiso: acá no se decide qué se ofrece) cuyo nombre, o el de su grupo, contiene TODAS las palabras
 * de la consulta, sin distinguir mayúsculas ni acentos y en el orden del menú. «recet» encuentra «Recetas»; «reportes costos» encuentra «Costos y márgenes» dentro de Reportes. Una consulta
 * vacía (o solo espacios) no devuelve nada: el menú muestra entonces los grupos.
 * `rutasDeUnaEntrada` son las rutas de proceso que se abren desde una entrada del menú (`RUTAS_DE_UNA_ENTRADA`) que el rol puede ver: QUIEN LLAMA las filtra por permiso (acá no se decide qué se ofrece), y por
 * eso no tiene valor por defecto. Se muestran después de los ítems del grupo de su `entrada` (si ese ítem no está en el menú que recibe, la ruta no aparece), con el nombre de la ruta.
 */
export function buscarPantallaEnMenu(grupos: readonly GrupoNav[], consulta: string, rutasDeUnaEntrada: readonly RutaDeUnaEntrada[] = []): PantallaEncontrada[] {
  const palabras = normalizarParaBuscar(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const coincide = (label: string, grupoLabel: string) => {
    const texto = normalizarParaBuscar(`${label} ${grupoLabel}`);
    return palabras.every((p) => texto.includes(p));
  };
  return grupos.flatMap((g) => [
    ...g.items.filter((i) => coincide(i.label, g.label)).map((i) => ({ href: i.href, label: i.label, grupoId: g.id, grupoLabel: g.label })),
    ...rutasDeUnaEntrada
      .filter((r) => g.items.some((i) => i.href === r.entrada) && coincide(r.label, g.label))
      .map((r) => ({ href: r.href, label: r.label, grupoId: g.id, grupoLabel: g.label })),
  ]);
}
