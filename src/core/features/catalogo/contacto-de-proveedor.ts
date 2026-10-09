import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_CONTACTO, LARGO_MAXIMO_DETALLE, LARGO_MAXIMO_NOTAS, LARGO_MAXIMO_TELEFONO, validarEmailOpcional, validarTextoLibre } from "@/core/datos/limites";
import { validarCuit } from "@/core/fiscal/public";
import type { EntradaContactoDeProveedor, ValoresDeContactoDeProveedor } from "./proveedores.schema";

/**
 * Los datos de contacto de un proveedor y el mensaje del CUIT repetido, tal como los validaban en línea las Server Actions de `src/server/actions/catalogo/proveedores.ts`
 * (Hito 4 de la pureza, paso H4C-14): era `validarCamposDeContacto` de la acción, movida TAL CUAL. Puro: la usan el guard del alta (antes de toda lectura) y el caso de
 * uso de la edición (DESPUÉS de leer el proveedor, como antes). No es un guard por sí mismo.
 */

/**
 * Largo máximo de cada texto libre y formato del email (S-22), y el CUIT (dígito verificador). Recortados; vacío → `null`. Se valida en este orden (contacto,
 * teléfono, email, CUIT, condiciones de pago, notas) y gana el PRIMER rechazo, con su mismo texto.
 */
export function validarContactoDeProveedor(datos: EntradaContactoDeProveedor): ResultadoDato<ValoresDeContactoDeProveedor> {
  const campos = {
    contacto: validarTextoLibre(datos.contacto, "El contacto", LARGO_MAXIMO_CONTACTO),
    telefono: validarTextoLibre(datos.telefono, "El teléfono", LARGO_MAXIMO_TELEFONO),
    email: validarEmailOpcional(datos.email),
    cuit: validarCuit(datos.cuit),
    condicionesPago: validarTextoLibre(datos.condicionesPago, "Las condiciones de pago", LARGO_MAXIMO_DETALLE),
    notas: validarTextoLibre(datos.notas, "Las notas", LARGO_MAXIMO_NOTAS),
  };
  for (const r of Object.values(campos)) if (!r.ok) return rechazar(r.codigo, r.mensaje);
  const valor = (r: ResultadoDato<string | null>): string | null => (r.ok ? r.valor : null);
  return aceptar({
    contacto: valor(campos.contacto),
    telefono: valor(campos.telefono),
    email: valor(campos.email),
    cuit: valor(campos.cuit),
    condicionesPago: valor(campos.condicionesPago),
    notas: valor(campos.notas),
  });
}

/** El rechazo de un CUIT que ya tiene OTRO proveedor de la empresa, con el nombre de ese otro. */
export function mensajeCuitDuplicado(nombre: string): string {
  return `Ya existe un proveedor con ese CUIT («${nombre}»). Dos proveedores de una misma empresa no pueden compartir CUIT: revisá que esté bien cargado.`;
}
