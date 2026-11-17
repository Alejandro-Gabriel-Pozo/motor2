/**
 * GO-3b (U1): arma los LUGARES de entradas del FormData del formulario de cupos de una promo (los existentes que siguen tildados y, si se completó, uno nuevo). Puro: no valida ni escribe (lo hace
 * el guard de la acción); lo llama el closure "use server" de la página de la carta.
 */
import { cantidadesDelFormulario } from "@/core/carta/public";

/** Un campo del formulario como texto (vacío si no vino). */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");
/** Un campo del formulario como texto, o `null` si no se dibujó (para elegir entre «cantidad exacta» y «mín./máx.»). */
const leer = (fd: FormData) => (nombre: string) => {
  const valor = fd.get(nombre);
  return valor === null ? null : String(valor);
};

/** GO-3b: los lugares de entradas que vienen en el formulario de cupos (los existentes que siguen tildados y, si se completó, uno nuevo). */
export function lugaresDelFormulario(fd: FormData): { tipo: "LISTA"; nombre: string; cantidadMinima: string; cantidadMaxima: string }[] {
  const ids = fd.getAll("lugar_id").map(String);
  const existentes = ids.flatMap((lid) => {
    if (!fd.get(`lugar_incluir_${lid}`)) return [];
    return [{ tipo: "LISTA" as const, nombre: campo(fd, `lugar_nombre_${lid}`), ...cantidadesDelFormulario(leer(fd), `lugar_cantidad_${lid}`, `lugar_min_${lid}`, `lugar_max_${lid}`) }];
  });
  const nombreNuevo = campo(fd, "nuevo_lugar_nombre").trim();
  const nuevo = nombreNuevo && campo(fd, "nuevo_lugar_tipo") === "LISTA" ? [{ tipo: "LISTA" as const, nombre: nombreNuevo, ...cantidadesDelFormulario(leer(fd), "nuevo_lugar_cantidad", "nuevo_lugar_min", "nuevo_lugar_max") }] : [];
  return [...existentes, ...nuevo];
}


/** Los cupos de SECCIÓN que vienen en el formulario de cupos de una promo (las secciones tildadas, cada una con su cantidad exacta o con «mín.» y «máx.»). Puro: no valida ni escribe (lo hace el guard). */
export function cuposDeSeccionDelFormulario(fd: FormData, secciones: readonly { id: string }[]): { seccionCartaId: string; cantidadMinima: string; cantidadMaxima: string }[] {
  return secciones.flatMap((s) => {
    if (!fd.get(`incluir_${s.id}`)) return [];
    return [{ seccionCartaId: s.id, ...cantidadesDelFormulario(leer(fd), `cantidad_${s.id}`, `min_${s.id}`, `max_${s.id}`) }];
  });
}
