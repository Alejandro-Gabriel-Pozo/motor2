import { Aviso } from "@/ui/primitivas/aviso";

/**
 * Aviso para quien puede VER una pantalla de Catálogo pero no EDITARLA (DEC-33: ver ≠ escribir con niveles de la misma clave; diseño `docs/diseno-modulo-catalogo-2026-10-28.md` I2). Va arriba de la
 * pantalla, que se dibuja sin los formularios ni los botones de cambio: dice por qué no se puede tocar. El servidor rechaza igual cualquier escritura (`conPermiso*`); esto es solo lo que se ve. `quien` es
 * a quién pedirle el cambio (por defecto, quien administra el catálogo; el precio local es de la sucursal).
 */
export function AvisoSoloLecturaDeCatalogo({ que, quien = "quien administra el catálogo" }: { que: string; quien?: string }) {
  return (
    <Aviso variante="informacion" data-aviso-solo-lectura="">
      Solo lectura: tu rol puede ver {que}, pero no hacer cambios. Si hace falta un cambio, pedíselo a {quien}.
    </Aviso>
  );
}
