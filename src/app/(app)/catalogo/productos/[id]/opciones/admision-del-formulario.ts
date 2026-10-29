import { numeroDelCampo } from "@/core/datos/numero-tecleado";

/**
 * Lo que manda el formulario de un grupo en «Opciones de venta» de un producto (`AdmisionDeGrupo`) armado como el comando de `fijarAdmisionDeGrupoEnProducto`, salvo el producto,
 * el grupo y la versión (que pone el closure de la página). NO valida: el guard y las reglas puras del servidor lo hacen todo (por eso devuelve `unknown`). Un número mal escrito
 * llega como `NaN` y el servidor lo rechaza con su mensaje; un mínimo o un máximo vacío es `null` («el del grupo»). Las opciones viajan como JSON en un campo oculto.
 */
export function admisionDelFormulario(fd: FormData): {
  orden: unknown;
  cantidadMinima: unknown;
  cantidadMaxima: unknown;
  modoPrecio: unknown;
  activo: boolean;
  seMuestraEnCarta: boolean | undefined;
  opciones: unknown;
} {
  const vacioONumero = (nombre: string) => {
    const t = String(fd.get(nombre) ?? "").trim();
    return t === "" ? null : numeroDelCampo(t);
  };
  const crudo = String(fd.get("opciones") ?? "[]");
  let opciones: unknown;
  try {
    opciones = JSON.parse(crudo) as unknown;
  } catch {
    opciones = crudo;
  }
  const modo = String(fd.get("modoPrecio") ?? "").trim();
  return {
    orden: numeroDelCampo(String(fd.get("orden") ?? "0")) ?? 0,
    cantidadMinima: vacioONumero("cantidadMinima"),
    cantidadMaxima: vacioONumero("cantidadMaxima"),
    modoPrecio: modo === "" ? null : modo,
    activo: fd.get("activo") === "on",
    // «Mostrar este grupo en la carta»: el formulario manda «si» o «no» solo en un grupo que se puede ocultar (variante o incluida); sin el campo, el servidor conserva lo guardado.
    seMuestraEnCarta: fd.get("seMuestraEnCarta") === "si" ? true : fd.get("seMuestraEnCarta") === "no" ? false : undefined,
    opciones,
  };
}
