import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { mensajePisoDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import { validarCantidadCupoPromo } from "@/core/carta/validaciones";
import type { ComandoGuardarCuposPromoCarta, ResultadoGuardarCuposPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
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
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja exactamente los cupos pedidos en la promo (todo o nada), si cada uno es válido y todos los precios de la promo alcanzan el piso de los cupos nuevos.
 * @idempotency No aplica — repetir el pedido borra y vuelve a crear los mismos cupos.
 * @transaction `actor.transaccion` (READ COMMITTED): el borrado y la creación de los cupos juntos; las lecturas previas van con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría ni revalidación de la carta pública, como antes).
 * @ficha permiso=carta_promo_definir transaccion=SIMPLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarCuposPromoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion">,
  comando: ComandoGuardarCuposPromoCarta,
): Promise<ResultadoGuardarCuposPromoCarta> {
  const { promoCartaId, cupos } = comando;
  const promo = await actor.db.promoCarta.findUnique({ where: { id: promoCartaId }, include: { sucursales: { select: { precioLocal: true } } } });
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

  if (cuposValidados.length) {
    const secciones = await actor.db.seccionCarta.findMany({ where: { id: { in: [...seccionIds] } }, select: { id: true } });
    if (secciones.length !== seccionIds.size) return fracaso("SECCION_NO_ENCONTRADA", "Alguna sección de carta de los cupos no existe.");

    // D3: peor caso = todos los cupos en su máximo — el precio tiene que alcanzar el piso de $0,01 por unidad ahí también,
    // no solo en la elección mínima.
    // Vale para el precio de la empresa y para el precio local de CUALQUIER sucursal que lo tenga.
    const piso = pisoDePrecioDePromo(cuposValidados)!;
    for (const precio of [Number(promo.precio), ...promo.sucursales.flatMap((s) => (s.precioLocal !== null ? [Number(s.precioLocal)] : []))]) {
      if (precio < piso.minimo) return fracaso("BAJO_EL_PISO", mensajePisoDePromo(promo.titulo, precio, piso));
    }
  }

  await actor.transaccion(async (tx) => {
    await reemplazarCuposDePromo(tx, { promoCartaId, cupos: cuposValidados });
  });

  return exito(
    cuposValidados.length
      ? `Cupos de "${promo.titulo}" guardados (${cuposValidados.length}): ahora es una promo armable en el POS.`
      : `"${promo.titulo}" volvió a ser informativa (sin cupos): el POS deja de ofrecerla para armar.`,
    null,
  );
}
