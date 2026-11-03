import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";

/** Las claves de `C` cuyo valor es un texto: las que pueden ser el id que el guard exige. */
type ClaveDeId<C> = { [P in keyof C]: C[P] extends string ? P : never }[keyof C] & string;

/**
 * Guard de formato de un comando que exige UN id de texto y deja pasar TAL CUAL los demás campos que se nombran (`pasantes`; los valida el caso de uso). Si el id
 * no es un texto devuelve `rechazar("formato", mensaje)`, el mismo mensaje que «no encontrado». Solo se copian las claves nombradas: cualquier otra que llegue en
 * la entrada se descarta. Puro: sin Prisma ni permisos.
 */
export function guardDeId<C>(campoId: ClaveDeId<C>, mensaje: string, ...pasantes: Exclude<keyof C & string, typeof campoId>[]): (entrada: unknown) => ResultadoDato<C> {
  return (entrada) => {
    const recibido = (entrada ?? {}) as Record<string, unknown>;
    if (typeof recibido[campoId] !== "string") return rechazar("formato", mensaje);
    const comando: Record<string, unknown> = { [campoId]: recibido[campoId] };
    for (const clave of pasantes) comando[clave] = recibido[clave];
    return aceptar(comando as C);
  };
}
