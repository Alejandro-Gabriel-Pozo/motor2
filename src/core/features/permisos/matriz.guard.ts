import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { EstadoPermiso } from "@/core/permisos/matriz";

/** Un cambio de la matriz tal como lo manda la pantalla (modo edición con «Guardar»). */
export interface CambioDeMatriz {
  rolId: string;
  accionClave: string;
  /** Lo que la persona vio al abrir la edición: si en la base ya es otra cosa, alguien más lo cambió y NO se guarda nada. */
  anterior: EstadoPermiso;
  nuevo: EstadoPermiso;
}

/** Tope de cambios por guardado: la matriz completa hoy tiene 41 acciones × unos pocos roles. */
const MAXIMO_CAMBIOS = 1000;

const esBooleano = (v: unknown): v is boolean => typeof v === "boolean";
const estadoValido = (e: EstadoPermiso | undefined): e is EstadoPermiso => !!e && esBooleano(e.puedeVer) && esBooleano(e.puedeEditar);

/**
 * Guard del comando «guardar los cambios de la matriz de permisos» (Hito 3, Fase I, I.3 de `docs/plan-hito-3-pureza.md`). Formato, ANTES de tocar la base;
 * lo llama la Server Action `guardarPermisos` DENTRO de `conEdicionDePermisos("gestion_permisos", …)`, así que el rechazo por permiso (y por la política de
 * plataforma) sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Son EXACTAMENTE las validaciones que antes corrían en línea en `src/server/actions/permisos/permisos.ts`, en el MISMO orden y con los MISMOS textos: que
 * sea una lista, el tope de cambios, la forma de cada cambio (ids y claves de texto, los dos estados con booleanos) y que no haya dos cambios para la misma
 * celda. Que el rol y la acción existan, el piso de la acción y lo que efectivamente cambia los resuelve el caso de uso contra la base. Devuelve la lista tal
 * cual llegó.
 */
export function guardComandoGuardarPermisos(cambios: CambioDeMatriz[]): ResultadoDato<CambioDeMatriz[]> {
  if (!Array.isArray(cambios)) return rechazar("vacio", "No hay cambios para guardar.");
  if (cambios.length > MAXIMO_CAMBIOS) return rechazar("rango", "Son demasiados cambios de una vez.");
  for (const c of cambios) {
    if (typeof c?.rolId !== "string" || typeof c?.accionClave !== "string" || !estadoValido(c.anterior) || !estadoValido(c.nuevo)) {
      return rechazar("formato", "Los cambios no tienen el formato esperado.");
    }
  }
  const claves = new Set<string>();
  for (const c of cambios) {
    const clave = `${c.rolId}:${c.accionClave}`;
    if (claves.has(clave)) return rechazar("formato", "Hay dos cambios para la misma celda.");
    claves.add(clave);
  }
  return aceptar(cambios);
}
