import type { GrupoNav } from "./estructura";

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
 */
export function buscarPantallaEnMenu(grupos: readonly GrupoNav[], consulta: string): PantallaEncontrada[] {
  const palabras = normalizarParaBuscar(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  return grupos.flatMap((g) =>
    g.items
      .filter((i) => {
        const texto = normalizarParaBuscar(`${i.label} ${g.label}`);
        return palabras.every((p) => texto.includes(p));
      })
      .map((i) => ({ href: i.href, label: i.label, grupoId: g.id, grupoLabel: g.label }))
  );
}
