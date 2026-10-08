import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { mensajePisoDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import { validarCantidadCupoPromo } from "@/core/carta/validaciones";
import type { ComandoGuardarCuposPromoCarta, ResultadoGuardarCuposPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { reemplazarCuposDePromo } from "@/server/persistencia/carta/promos";

/**
 * Caso de uso «reemplazar TODOS los cupos de una promo» (Hito 4 de la pureza, bloque 4.2, paso H4C-3 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes
 * vivía en línea en la Server Action `guardarCuposPromoCarta` (`src/server/actions/carta/promos.ts`), movido TAL CUAL: la promo (con el precio local de cada
 * sucursal) y las secciones se leen con la base del contexto FUERA de la transacción; los cupos se validan en el mismo orden y con los mismos textos, DESPUÉS de
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
 * @transaction `actor.transaccion` (READ COMMITTED): las lecturas (promo, cupos de antes, secciones, piso), el borrado y la creación de los cupos y su auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (PromoCartaCupo.cantidadMinima y .cantidadMaxima por sección, del anterior al nuevo), en la misma transacción. Sin revalidación de la carta pública, como antes.
 * @ficha permiso=carta_promo_definir transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarCuposPromoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoGuardarCuposPromoCarta,
): Promise<ResultadoGuardarCuposPromoCarta> {
  const { promoCartaId, cupos } = comando;
  // S-06: la promo, los cupos de antes, las secciones, el piso de precio y el reemplazo con su auditoría van en UNA transacción (antes: las lecturas con `actor.db`, afuera, y
  // el reemplazo sin rastro). Los rechazos devuelven ANTES de escribir, así que la transacción no deja nada. `actor.transaccion` puede reintentar el cuerpo: no tiene efectos fuera de la base.
  return actor.transaccion(async (tx): Promise<ResultadoGuardarCuposPromoCarta> => {
    const promo = await tx.promoCarta.findUnique({ where: { id: promoCartaId }, include: { sucursales: { select: { precioLocal: true } } } });
    if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");

    const seccionIds = new Set<string>();
    const cuposValidados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number; orden: number }[] = [];
    for (const [i, c] of cupos.entries()) {
      if (!c.seccionCartaId) return fracaso("CUPO_INVALIDO", "Elegí la sección de cada cupo.");
      if (seccionIds.has(c.seccionCartaId)) return fracaso("CUPO_INVALIDO", "No se puede repetir la misma sección de carta en dos cupos de la misma promo.");
      seccionIds.add(c.seccionCartaId);

      const minima = validarCantidadCupoPromo(c.cantidadMinima, "La cantidad mínima", 0);
      if (!minima.ok) return fracaso("CUPO_INVALIDO", minima.mensaje);
      const maxima = validarCantidadCupoPromo(c.cantidadMaxima, "La cantidad máxima");
      if (!maxima.ok) return fracaso("CUPO_INVALIDO", maxima.mensaje);
      if (maxima.valor < 1) return fracaso("CUPO_INVALIDO", "La cantidad máxima de un cupo tiene que ser al menos 1.");
      if (minima.valor > maxima.valor) return fracaso("CUPO_INVALIDO", "En cada cupo, el mínimo no puede ser mayor que el máximo.");

      cuposValidados.push({ seccionCartaId: c.seccionCartaId, cantidadMinima: minima.valor, cantidadMaxima: maxima.valor, orden: i });
    }

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
