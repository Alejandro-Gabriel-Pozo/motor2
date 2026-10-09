import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { mensajePisoDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import type { ComandoGuardarCuposPromoCarta, ResultadoGuardarCuposPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { reemplazarCuposDePromo } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «reemplazar TODOS los cupos de una promo» (Hito 4 de la pureza, bloque 4.2, paso H4C-3 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes
 * vivía en línea en la Server Action `guardarCuposPromoCarta` (`src/server/actions/carta/promos.ts`), movido con el mismo orden y los mismos textos (M-6 de la auditoría
 * intermedia: este encabezado decía que la promo y las secciones se leían FUERA de la transacción; desde S-06 se leen DENTRO de ella, y el caso de uso ya no recibe `actor.db`): los cupos se validan, DESPUÉS de
 * leer la promo (por eso no hay guard); el piso de $0,01 por unidad del peor caso (`core/carta/piso-de-promo.ts`) se mide contra el precio de la empresa y el
 * precio local de CUALQUIER sucursal que lo tenga; y el reemplazo (borrar todos y crear los nuevos) va en UNA transacción. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("carta_promo_definir")` → este caso de uso → `aResultadoAccion`). El criterio de negocio (la lista que llega es la lista final; vacía =
 * informativa) está documentado en la Server Action.
 *
 * Hallazgo informado por el plan y migrado TAL CUAL: a diferencia de las otras acciones de promos, esta NO revalida la carta pública (los cupos no se muestran
 * en la carta: solo cambian qué arma el POS).
 *
 * S-06 (plan de endurecimiento de seguridad, tanda T2): antes el reemplazo no dejaba rastro. Ahora lee la promo, los cupos de antes, las secciones y el piso DENTRO de la
 * transacción y audita cada columna de cada cupo que cambia (`PromoCartaCupo`, ver `auditarCupos`), en esa misma transacción.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja exactamente los cupos pedidos en la promo (todo o nada), si cada uno es válido y todos los precios de la promo alcanzan el piso de los cupos nuevos; y deja una fila de auditoría por cada columna de cupo que cambió.
 * @idempotency No aplica — repetir el pedido borra y vuelve a crear los mismos cupos (sin filas de auditoría nuevas: no cambió nada).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento): las lecturas (promo, cupos de antes, secciones, piso), el borrado y la creación de los cupos y su auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (PromoCartaCupo.cantidadMinima y .cantidadMaxima por sección, del anterior al nuevo), en la misma transacción. Sin revalidación de la carta pública, como antes.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarCuposPromoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId">,
  comando: ComandoGuardarCuposPromoCarta,
): Promise<ResultadoGuardarCuposPromoCarta> {
  const { promoCartaId, cupos } = comando;
  // S-06: la promo, los cupos de antes, las secciones, el piso de precio y el reemplazo con su auditoría van en UNA transacción (antes: las lecturas con `actor.db`, afuera, y
  // el reemplazo sin rastro). M-5 de la auditoría intermedia: SERIALIZABLE (antes READ COMMITTED): dos reemplazos a la vez, o este contra un cambio de precio, no se pisan en silencio —uno aborta
  // (40001), el reintento relee— y el «anterior» de la auditoría es siempre el que de verdad se reemplazó. Los rechazos devuelven ANTES de escribir, así que la transacción no deja nada;
  // el cuerpo puede reintentarse: no tiene efectos fuera de la base.
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoGuardarCuposPromoCarta> => {
    const promo = await tx.promoCarta.findUnique({ where: { id: promoCartaId }, include: { sucursales: { select: { precioLocal: true } } } });
    if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");

    // S-52: la forma, el tope de la lista y el rango de cada cupo los decidió `guardComandoGuardarCuposPromoCarta` (la acción lo calculó con lo que mandó el cliente); su rechazo se aplica ACÁ,
    // después de leer la promo: una promo inexistente gana sobre un cupo inválido.
    if (!cupos.ok) return fracaso("CUPO_INVALIDO", cupos.mensaje);
    const cuposValidados = cupos.valor;
    const seccionIds = new Set(cuposValidados.map((c) => c.seccionCartaId));

    // Los nombres de las secciones nuevas, para la descripción de la auditoría (los de las que se van salen de los cupos de antes).
    const nombresDeSecciones = new Map<string, string>();
    if (cuposValidados.length) {
      const secciones = await tx.seccionCarta.findMany({ where: { id: { in: [...seccionIds] } }, select: { id: true, nombre: true } });
      if (secciones.length !== seccionIds.size) return fracaso("SECCION_NO_ENCONTRADA", "Alguna sección de carta de los cupos no existe.");
      for (const s of secciones) nombresDeSecciones.set(s.id, s.nombre);

      // D3: peor caso = todos los cupos en su máximo — el precio tiene que alcanzar el piso de $0,01 por unidad ahí también,
      // no solo en la elección mínima.
      // Vale para el precio de la empresa y para el precio local de CUALQUIER sucursal que lo tenga.
      const piso = pisoDePrecioDePromo(cuposValidados)!;
      for (const precio of [Number(promo.precio), ...promo.sucursales.flatMap((s) => (s.precioLocal !== null ? [Number(s.precioLocal)] : []))]) {
        if (precio < piso.minimo) return fracaso("BAJO_EL_PISO", mensajePisoDePromo(promo.titulo, precio, piso));
      }
    }

    const previos = await tx.promoCartaCupo.findMany({
      where: { promoCartaId },
      select: { seccionCartaId: true, cantidadMinima: true, cantidadMaxima: true, seccionCarta: { select: { nombre: true } } },
    });
    for (const p of previos) nombresDeSecciones.set(p.seccionCartaId, p.seccionCarta.nombre);

    await reemplazarCuposDePromo(tx, { promoCartaId, cupos: cuposValidados });
    await auditarCupos(tx, actor.usuarioId, { promoCartaId, titulo: promo.titulo, nombresDeSecciones, previos, nuevos: cuposValidados });

    return exito(
      cuposValidados.length
        ? `Cupos de "${promo.titulo}" guardados (${cuposValidados.length}): ahora es una promo armable en el POS.`
        : `"${promo.titulo}" volvió a ser informativa (sin cupos): el POS deja de ofrecerla para armar.`,
      null,
    );
  });
}

/**
 * S-06: una fila de auditoría por cada columna (`cantidadMinima`, `cantidadMaxima`) de cada cupo que cambia, aparece (anterior `null`) o desaparece (nuevo `null`). Los cupos fijan
 * cuántas unidades de cada sección entran por el precio de la promo: subir un máximo de 2 a 30 cambia cuánta mercadería sale por el mismo importe. `entidadId` es
 * `${promoCartaId}:${seccionCartaId}` (la clave natural del cupo: el reemplazo borra y recrea las filas, así que su id no sirve). La promo es de la empresa: `sucursalId` null.
 * Va dentro de la transacción del reemplazo; un cupo que no cambió no deja fila (`registrarCambioAuditado` ignora el «no cambió»).
 */
async function auditarCupos(
  tx: Parameters<typeof registrarCambioAuditado>[0],
  actorId: string,
  datos: {
    promoCartaId: string;
    titulo: string;
    nombresDeSecciones: ReadonlyMap<string, string>;
    previos: readonly { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
    nuevos: readonly { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
  },
): Promise<void> {
  const antes = new Map(datos.previos.map((c) => [c.seccionCartaId, c]));
  const despues = new Map(datos.nuevos.map((c) => [c.seccionCartaId, c]));
  for (const seccionCartaId of new Set([...antes.keys(), ...despues.keys()])) {
    const nombreDeSeccion = datos.nombresDeSecciones.get(seccionCartaId) ?? seccionCartaId;
    const columnas = [
      { campo: "cantidadMinima", etiqueta: "cantidad mínima" },
      { campo: "cantidadMaxima", etiqueta: "cantidad máxima" },
    ] as const;
    for (const { campo, etiqueta } of columnas) {
      await registrarCambioAuditado(tx, {
        entidad: "PromoCartaCupo",
        entidadId: `${datos.promoCartaId}:${seccionCartaId}`,
        campo,
        descripcion: `Promo "${datos.titulo}": cupo de la sección "${nombreDeSeccion}", ${etiqueta}`,
        valorAnterior: antes.get(seccionCartaId)?.[campo] ?? null,
        valorNuevo: despues.get(seccionCartaId)?.[campo] ?? null,
        actorId,
      });
    }
  }
}
