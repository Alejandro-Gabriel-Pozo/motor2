/**
 * GO-3b (U1): arma los LUGARES de entradas del FormData del formulario de cupos de una promo (los existentes que siguen tildados y, si se completó, uno nuevo). Puro: no valida ni escribe (lo hace
 * el guard de la acción); lo llama el closure "use server" de la página de la carta.
 */
/** Un campo del formulario como texto (vacío si no vino). */
const campo = (fd: FormData, nombre: string) => String(fd.get(nombre) ?? "");

/** GO-3b: los lugares de entradas que vienen en el formulario de cupos (los existentes que siguen tildados y, si se completó, uno nuevo). */
export function lugaresDelFormulario(fd: FormData): { tipo: "LISTA" | "DEL_DIA"; nombre: string; cantidadMinima: string; cantidadMaxima: string }[] {
  const ids = fd.getAll("lugar_id").map(String);
  const existentes = ids.flatMap((lid) => {
    if (!fd.get(`lugar_incluir_${lid}`)) return [];
    const tipo = campo(fd, `lugar_tipo_${lid}`) === "DEL_DIA" ? ("DEL_DIA" as const) : ("LISTA" as const);
    return [{ tipo, nombre: campo(fd, `lugar_nombre_${lid}`), cantidadMinima: campo(fd, `lugar_min_${lid}`), cantidadMaxima: campo(fd, `lugar_max_${lid}`) }];
  });
  const nombreNuevo = campo(fd, "nuevo_lugar_nombre").trim();
  const tipoNuevo = campo(fd, "nuevo_lugar_tipo");
  const nuevo = nombreNuevo && (tipoNuevo === "LISTA" || tipoNuevo === "DEL_DIA") ? [{ tipo: tipoNuevo as "LISTA" | "DEL_DIA", nombre: nombreNuevo, cantidadMinima: campo(fd, "nuevo_lugar_min"), cantidadMaxima: campo(fd, "nuevo_lugar_max") }] : [];
  return [...existentes, ...nuevo];
}

