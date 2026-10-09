import { planteoEstatico, type Escenario } from "./argumentos";
import { ESCENARIOS_QUE_NO_APLICAN } from "./excepciones";
import { GENERADORES, SIN_GENERADOR } from "./generadores";
import type { PuertaInventariada } from "./inventario-de-puertas";
import { PUERTAS_SIN_PERMISO } from "../../arquitectura/guardas/puertas-sin-permiso";

/**
 * Qué escenarios de la matriz de denegación por defecto (GT-3b) le corresponden a cada puerta. Sin base de datos: la decisión sale de la forma de la puerta (su guarda, su contexto, los ids que recibe) y de
 * las listas de excepciones.
 *
 *  - `anonimo` y `sinEmpresa`: toda puerta, salvo lo que GT-10 deja PERMITIDO a propósito (el token de una invitación, el login).
 *  - `ajenaEmpresa` y `ajenaSucursal`: una MUTACIÓN solo si la derivación usa algún id AJENO de ese escenario (sin uno, la escritura es PROPIA y legítima: `crearMesa(numero)` crea la mesa de quien actúa); una
 *    LECTURA siempre (no puede traer filas ajenas). `ajenaSucursal` no aplica a una acción de CONTEXTO EMPRESA: su autoridad es la empresa entera y lo de una sucursal de la empresa es alcanzable por diseño
 *    (renombrar una sucursal, apagar la cuenta de un usuario, leer las capacidades de todas): la defensa de esas es que el id sea de la empresa (escenario `ajenaEmpresa`).
 *  - `propia`: las lecturas, con ids propios, como control positivo (devuelven algo propio).
 *  - `controlMutacion`: las mutaciones, con ids propios y válidos, como control positivo (terminan en `ok: true`; el mundo se vuelve a sembrar después). Las que no se pueden armar van a `SIN_CONTROL_POSITIVO`.
 */
function esLectura(puerta: PuertaInventariada): boolean {
  return puerta.tipo !== "accion" || puerta.guarda.startsWith("requerirVer");
}

export const TODOS_LOS_ESCENARIOS: readonly Escenario[] = ["anonimo", "sinEmpresa", "ajenaEmpresa", "ajenaSucursal", "propia", "controlMutacion"];

export function escenariosDe(puerta: PuertaInventariada): Escenario[] {
  if (Object.hasOwn(SIN_GENERADOR, puerta.clave)) return [];
  const salida: Escenario[] = [];
  for (const escenario of TODOS_LOS_ESCENARIOS) {
    if (Object.hasOwn(ESCENARIOS_QUE_NO_APLICAN, `${puerta.clave}|${escenario}`)) continue;
    if (escenario === "propia" && !esLectura(puerta)) continue;
    // El control positivo de las MUTACIONES: con ids propios y válidos tiene que terminar en `ok: true` (en un mundo descartable). Sin él, un rechazo por forma pasa por «denegado».
    if (escenario === "controlMutacion" && !puerta.mutacion) continue;
    // La postura declarada en GT-10 (puertas sin `conPermiso`): lo que ella deja PERMITIDO a un anónimo o a un sin-empresa no se niega (token de invitación, login…); lo demás sí.
    const gt10 = puerta.tipo === "accion" ? PUERTAS_SIN_PERMISO[`accion|${puerta.archivo.replace(/^actions\//, "")}|${puerta.nombre}`] : undefined;
    if (gt10 && escenario === "anonimo" && gt10.anonimo === "PERMITIDO") continue;
    if (gt10 && escenario === "sinEmpresa" && gt10.sinEmpresa === "PERMITIDO") continue;
    if (gt10 && (escenario === "propia" || escenario === "controlMutacion")) continue;
    const p = planteoEstatico(puerta, escenario, GENERADORES);
    if (!p.argumentos) continue;
    if (escenario === "ajenaEmpresa" || escenario === "ajenaSucursal") {
      const sinIdAjeno = p.usados.length === 0;
      if (!esLectura(puerta) && sinIdAjeno) continue;
      if (escenario === "ajenaSucursal" && puerta.contexto === "empresa") continue;
    }
    salida.push(escenario);
  }
  return salida;
}
