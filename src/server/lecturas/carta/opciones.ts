import { versionVigente, type DiferenciaDePrecio, type ModoDePrecioDeMedida, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { GrupoParaVender } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * GO-2d (ADR-030; decisión del dueño: la carta pública muestra las opciones): las opciones de venta de los productos de la carta de UNA sucursal, con lo justo para calcular los
 * precios que se muestran (el «desde», cada tamaño, cada recargo) con la MISMA regla que la venta (`resumenDePrecios`). `select` campo por campo y SOLO lo de la lista aprobada
 * (GO-0 §4, `PUBLICACION_CARTA` en `test/arquitectura/carta-publica-lista-cerrada.test.ts`): NUNCA `factorEscala`, los consumos (`ConsumoDeOpcion`, son de la receta), el producto
 * que respalda un adicional (`OpcionDeGrupo.productoId`) ni la foto de lo vendido. Además `tipoDeDiferencia` y `porcentaje`, que GO-0 no listaba porque el recargo en % llegó
 * después (GO-2a): sin ellos un recargo en % se mostraría mal.
 *
 * Lo que devuelve tiene la forma de la venta (`GrupoParaVender`) para usar la misma cuenta, pero lo que la carta NO lee queda neutro y no sale nunca (lo proyecta campo por campo
 * `core/carta/carta-publica.ts`): sin ancla, sin factor, sin consumos y sin el id de la versión (la carta no vende). La vigente es la de número mayor (`versionVigente`). Lo
 * apagado en ESTA sucursal se lee con su `sucursalId` en el `where` (además de la base de solo lectura de esa sucursal). La grilla de la sucursal la pone quien llama, con su
 * lector único (`precio-local-de-opciones.ts`).
 *
 * SIN `import "server-only"` a propósito, como las demás lecturas de la carta (`menu.ts`, `descuentos.ts`): las alcanza la carta pública y los tests la llaman directo.
 */

function diferencia(tipo: string | null, monto: { toNumber(): number } | null, porcentaje: { toNumber(): number } | null): DiferenciaDePrecio | null {
  if (tipo === "MONTO" && monto !== null) return { tipo: "MONTO", monto: monto.toNumber() };
  if (tipo === "PORCENTAJE" && porcentaje !== null) return { tipo: "PORCENTAJE", porcentaje: porcentaje.toNumber() };
  return null;
}

export async function opcionesDeLosProductosDeLaCarta(db: Db, sucursalId: string, productoIds: readonly string[]): Promise<Map<string, GrupoParaVender[]>> {
  const ids = [...new Set(productoIds)];
  if (ids.length === 0) return new Map();
  const productos = await db.producto.findMany({
    where: { id: { in: ids }, gruposAdmitidos: { some: { activo: true } } },
    select: {
      id: true,
      opcionesAdmitidas: { select: { opcionId: true, cantidadMaxima: true, precioAbsoluto: true, tipoDeDiferencia: true, diferenciaPrecio: true, porcentaje: true, activo: true } },
      gruposAdmitidos: {
        orderBy: [{ orden: "asc" }, { id: "asc" }],
        select: {
          orden: true,
          cantidadMinima: true,
          cantidadMaxima: true,
          modoPrecio: true,
          activo: true,
          grupo: {
            select: {
              id: true,
              nombre: true,
              tipo: true,
              cantidadMinima: true,
              cantidadMaxima: true,
              activo: true,
              opciones: {
                orderBy: [{ orden: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  nombre: true,
                  orden: true,
                  activa: true,
                  esNinguna: true,
                  apagadasEnSucursal: { where: { sucursalId }, select: { apagada: true } },
                  versiones: { orderBy: { numero: "desc" }, take: 1, select: { numero: true, tipoDeDiferencia: true, diferenciaPrecio: true, porcentaje: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const salida = new Map<string, GrupoParaVender[]>();
  for (const p of productos) {
    const admite = new Map(p.opcionesAdmitidas.map((a) => [a.opcionId, a]));
    salida.set(
      p.id,
      p.gruposAdmitidos.map((pg) => ({
        grupoId: pg.grupo.id,
        nombre: pg.grupo.nombre,
        tipo: pg.grupo.tipo as TipoDeGrupoDeOpciones,
        activo: pg.grupo.activo,
        admitido: pg.activo,
        cantidadMinima: pg.cantidadMinima ?? pg.grupo.cantidadMinima,
        cantidadMaxima: pg.cantidadMaxima ?? pg.grupo.cantidadMaxima,
        orden: pg.orden,
        modoPrecio: pg.modoPrecio as ModoDePrecioDeMedida | null,
        opciones: pg.grupo.opciones.flatMap((o) => {
          const vigente = versionVigente(o.versiones);
          if (!vigente) return [];
          const a = admite.get(o.id) ?? null;
          return [
            {
              opcionId: o.id,
              nombre: o.nombre,
              orden: o.orden,
              activa: o.activa,
              admitida: a !== null && a.activo,
              apagadaEnSucursal: o.apagadasEnSucursal[0]?.apagada ?? false,
              cantidadMaxima: a?.cantidadMaxima ?? 0,
              // Lo que la carta no lee (ver arriba): neutro, nunca sale.
              versionVigenteId: "",
              productoAnclaId: null,
              factorEscala: null,
              consumos: [],
              esNinguna: o.esNinguna,
              diferenciaDeLaVersion: diferencia(vigente.tipoDeDiferencia, vigente.diferenciaPrecio, vigente.porcentaje) ?? { tipo: "MONTO", monto: 0 },
              precioAbsoluto: a?.precioAbsoluto == null ? null : a.precioAbsoluto.toNumber(),
              diferenciaDelProducto: a ? diferencia(a.tipoDeDiferencia, a.diferenciaPrecio, a.porcentaje) : null,
              precioDeSucursal: null,
            },
          ];
        }),
      }))
    );
  }
  return salida;
}
