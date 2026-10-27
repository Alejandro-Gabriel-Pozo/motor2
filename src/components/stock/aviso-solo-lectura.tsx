import { Aviso } from "@/ui/primitivas/aviso";

/**
 * Aviso para quien puede VER una pantalla de configuración de Stock pero no EDITARLA (DEC-33: ver ≠ escribir con niveles de la misma clave). Va arriba de la pantalla, junto al formulario deshabilitado:
 * dice por qué no se puede tocar. El servidor rechaza igual cualquier escritura (`conPermiso`); esto es solo lo que se ve.
 */
export function AvisoSoloLecturaDeStock({ que }: { que: string }) {
  return (
    <Aviso variante="informacion" data-aviso-solo-lectura="">
      Solo lectura: tu rol puede ver {que}, pero no cambiarlo. Si necesitás cambiarlo, pedíselo a quien administra la sucursal.
    </Aviso>
  );
}
