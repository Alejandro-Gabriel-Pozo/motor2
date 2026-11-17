import { nombreDeFicha } from "@/core/datos/nombre-de-ficha";
import { decidirLayoutPortal, posicionCompleta, resolverEstiloPortal } from "./portal";
import type { TarjetaDePortal } from "./portal-de-empresa";

/**
 * SEMBRADO del portal nuevo desde lo que la empresa YA tiene cargado (riesgo del paso «Colores del portal»: hoy un portal sin fila nueva se lee de `SucursalPublica` y del Json `PortalCartaEmpresa.valores`; al crear la fila `PortalDeEmpresa`, la lectura dual pasa a las tablas
 * nuevas y el portal NO puede quedar sin sucursales ni cambiar de aspecto). PURO. Se decide en la MISMA transacción del alta (`casos-de-uso/guardar-colores-del-portal.ts`): el portal se ve IGUAL antes y después de crear la fila.
 *
 * Lo que la fila nueva modela y está vacío (colores, textos) NO se siembra: con la pantalla simple encendida la lectura usa lo cargado en el Json cuando la columna está vacía (`estiloDelPortalSimple`, `portal-colores.ts`). Lo que SÍ hay que sembrar son las TARJETAS (la
 * lectura nueva lista solo las que tienen tarjeta): una por cada registro público (`SucursalPublica`) con `orden` el suyo, `visible = publicada` y `nombre = etiqueta` (vacía = el nombre de la sucursal: `null`), las reglas del backfill del diseño
 * `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §8 (variante A). Y SOLO si el portal de hoy es una lista. Si hoy es un MAPA (imagen de fondo y al menos una sucursal publicada y activa con posición completa) o el nombre de una sucursal en el portal no entra
 * en una tarjeta, NO se siembra y la acción se niega con el motivo: cierra en vez de cambiar el portal sin avisar. Es una pregunta abierta para el dueño (pasar un mapa a la variante B con zonas es otra etapa).
 */

/** Un registro público de sucursal tal como lo lee la base (todas las de la empresa, también las no publicadas). */
export interface RegistroPublicoParaSembrar {
  sucursalId: string;
  publicada: boolean;
  /** `Sucursal.activo`. */
  activa: boolean;
  orden: number;
  etiqueta: string | null;
  posX: number | null;
  posY: number | null;
  posW: number | null;
  posH: number | null;
}

type ResultadoDelSembrado = { ok: true; tarjetas: TarjetaDePortal[] } | { ok: false; mensaje: string };

const NO_ENTRA = "El portal de la empresa ya tiene cargado algo que esta pantalla todavía no puede mantener igual";

/** Las tarjetas que dejan el portal de hoy igual, o el motivo por el que no se puede. */
export function sembrarTarjetasDelPortal(args: { valoresJson: unknown; registros: readonly RegistroPublicoParaSembrar[] }): ResultadoDelSembrado {
  const estilo = resolverEstiloPortal(args.valoresJson);
  const visibles = args.registros.filter((r) => r.publicada && r.activa).map((r) => ({ posicion: posicionCompleta(r.posX, r.posY, r.posW, r.posH) }));
  if (decidirLayoutPortal(visibles, estilo.imagenFondo).modo === "mapa") {
    return { ok: false, mensaje: `${NO_ENTRA}: el portal se ve como mapa (imagen con sucursales ubicadas) y esta pantalla todavía no lo mantiene.` };
  }
  // La tarjeta pide `orden >= 0` y el registro público admite negativos: se corre todo lo mismo, así el orden y los empates (después, por nombre) quedan como estaban.
  const desplazamiento = Math.max(0, -Math.min(0, ...args.registros.map((r) => r.orden)));
  const tarjetas: TarjetaDePortal[] = [];
  for (const r of args.registros) {
    let nombre: string | null = null;
    if (r.etiqueta !== null && r.etiqueta.trim() !== "") {
      const n = nombreDeFicha(r.etiqueta, "ELECCION", "vacío");
      if (!n.ok) return { ok: false, mensaje: `${NO_ENTRA}: el nombre de una sucursal en el portal («${r.etiqueta.slice(0, 40)}») no entra en una tarjeta.` };
      nombre = n.valor;
    }
    tarjetas.push({ sucursalId: r.sucursalId, orden: r.orden + desplazamiento, visible: r.publicada, nombre, telefono: null, foto: null });
  }
  return { ok: true, tarjetas };
}
