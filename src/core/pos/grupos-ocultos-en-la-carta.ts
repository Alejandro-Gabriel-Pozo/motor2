import { seOcultaEnLaCarta, type DiferenciaDePrecio, type GrupoPermitido, type OpcionPermitida, type OpcionParaOcultarEnCarta } from "@/core/opciones/public";

/**
 * Un grupo con lo mínimo que la regla de «no se lee en la carta» necesita (forma estructural: lo cumple `GrupoParaVender` sin importarlo, así `linea-configurada` y `precio-de-configuracion` comparten esta
 * regla sin ciclo): el interruptor «Mostrar este grupo en la carta» (ausente = se muestra) y, de cada opción, lo ofrecido y la diferencia que rige.
 */
export interface GrupoParaOcultarEnLaCarta extends Omit<GrupoPermitido, "opciones"> {
  seMuestraEnCarta?: boolean;
  opciones: readonly (OpcionPermitida & { diferenciaDelProducto: DiferenciaDePrecio | null; diferenciaDeLaVersion: DiferenciaDePrecio; precioAbsoluto: number | null })[];
}

/** Lo que la regla de «no se lee en la carta» necesita de las opciones de un grupo, desde lo que ya leyó la venta: lo ofrecido (activa y admitida; lo agotado hoy NO cuenta) y la diferencia que rige. */
function opcionesParaOcultar(g: GrupoParaOcultarEnLaCarta): OpcionParaOcultarEnCarta[] {
  return g.opciones.map((o) => ({
    nombre: o.nombre,
    esNinguna: o.esNinguna,
    ofrecida: o.activa && o.admitida,
    diferencia: o.esNinguna ? null : (o.diferenciaDelProducto ?? o.diferenciaDeLaVersion),
    precioAbsoluto: o.precioAbsoluto,
  }));
}

/** Los grupos que la carta NO lee en este producto (`seOcultaEnLaCarta`, `core/opciones`): el único lugar donde la carta decide qué grupos lee, y de donde el ticket del cliente toma lo que no imprime. */
export function gruposOcultosEnLaCarta(grupos: readonly GrupoParaOcultarEnLaCarta[]): Set<string> {
  return new Set(grupos.filter((g) => seOcultaEnLaCarta({ tipo: g.tipo, ...(g.seMuestraEnCarta === undefined ? {} : { seMuestraEnCarta: g.seMuestraEnCarta }), opciones: opcionesParaOcultar(g) })).map((g) => g.grupoId));
}
