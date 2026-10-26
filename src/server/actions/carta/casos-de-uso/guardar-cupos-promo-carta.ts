import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { mensajePisoDePromo, mensajePisoLocalDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import { claveNaturalDeCupo, diferenciaDeCupos, MENU_DEL_DIA_VISIBLE, lugarDelDiaApagado, type CupoExistente, type CupoPedido, type TipoDeCupo } from "@/core/carta/public";
import type { ComandoGuardarCuposPromoCarta, ResultadoGuardarCuposPromoCarta } from "@/core/features/carta/promos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarCupoDePromo, crearCupoDePromo, darDeBajaCupoDePromo } from "@/server/persistencia/carta/promos";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { revisarAlicuotasEnTx } from "./componentes-de-combo-en-tx";
import { sucursalesDeLaEmpresa } from "@/server/lecturas/carta/componentes-de-promo";

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
 * GO-3b (ADR-032, paso D3): YA NO BORRA. Los cupos tienen una clave natural (la sección en un SECCION; el nombre sin mayúsculas en un LISTA o DEL_DIA) y guardar es llevar las filas
 * al estado pedido (`diferenciaDeCupos`, `core/carta/cupos-de-promo.ts`): lo que sigue se cambia en el lugar, lo que vuelve se reactiva, lo que no vino se da de baja (`activo = false`)
 * y lo nuevo se crea. Lee TODOS los cupos de la promo (también los dados de baja: un nombre dado de baja sigue ocupado y se reactiva, no se duplica). La auditoría es la misma de
 * siempre para los de sección (`entidadId` `${promoCartaId}:${seccionCartaId}`; una baja se registra como antes, con el nuevo `null`; volver de una baja, con el anterior `null`) y,
 * para los de entradas, con el id del cupo (`${promoCartaId}:${cupoId}`: la fila ya no cambia de id). Las entradas de una lista y los platos del día no se tocan acá.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * GO-3b (D-2): antes de escribir, las alícuotas de IVA de todos los componentes POSIBLES del combo con los lugares pedidos (`revisarAlicuotasEnTx`): no se mezclan alícuotas declaradas distintas.
 *
 * @contract Deja exactamente los cupos pedidos en la promo (todo o nada), si cada uno es válido y todos los precios de la promo alcanzan el piso de los cupos nuevos; y deja una fila de auditoría por cada columna de cupo que cambió.
 * @idempotency Por estado — repetir el pedido no escribe ni audita nada (cada cupo ya está como se pide).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, con `tambienChoqueDeUnico`: dos guardados a la vez que crean el MISMO cupo chocan con su único y el reintento relee y lo cambia en el lugar): las lecturas (promo, cupos de antes, secciones, piso), las escrituras de los cupos y su auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (PromoCartaCupo.cantidadMinima y .cantidadMaxima por sección, del anterior al nuevo), en la misma transacción. Sin revalidación de la carta pública, como antes.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarCuposPromoCartaCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "empresaId" | "db" | "alcance" | "ahora" | "empresaZonaHoraria">,
  comando: ComandoGuardarCuposPromoCarta,
): Promise<ResultadoGuardarCuposPromoCarta> {
  const { promoCartaId, cupos } = comando;
  // S-06: la promo, los cupos de antes, las secciones, el piso de precio y el reemplazo con su auditoría van en UNA transacción (antes: las lecturas con `actor.db`, afuera, y
  // el reemplazo sin rastro). M-5 de la auditoría intermedia: SERIALIZABLE (antes READ COMMITTED): dos reemplazos a la vez, o este contra un cambio de precio, no se pisan en silencio —uno aborta
  // (40001), el reintento relee— y el «anterior» de la auditoría es siempre el que de verdad se reemplazó. Los rechazos devuelven ANTES de escribir, así que la transacción no deja nada;
  // el cuerpo puede reintentarse: no tiene efectos fuera de la base.
  // Paquete 1 (RLS por sucursal): el piso se mide contra el precio local de CUALQUIER sucursal, y con las políticas una transacción con la sola sucursal activa vería únicamente SU precio local
  // (falla ABIERTO: se guardarían cupos que dejan bajo el piso el precio de otra sucursal). La transacción se abre con la lectura de verificación (toda la empresa, SOLO lectura): la escritura
  // (cupos y auditoría, de empresa) sigue como estaba.
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  return conTransaccionSerializable(
    verificacion.transaccion,
    async (tx): Promise<ResultadoGuardarCuposPromoCarta> => {
      const promo = await tx.promoCarta.findUnique({ where: { id: promoCartaId }, include: { sucursales: { select: { precioLocal: true } } } });
      if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");

      // S-52: la forma, el tope de la lista y el rango de cada cupo los decidió `guardComandoGuardarCuposPromoCarta` (la acción lo calculó con lo que mandó el cliente); su rechazo se aplica ACÁ,
      // después de leer la promo: una promo inexistente gana sobre un cupo inválido.
      if (!cupos.ok) return fracaso("CUPO_INVALIDO", cupos.mensaje);
      const cuposValidados = cupos.valor;
      const seccionIds = new Set(cuposValidados.flatMap((c) => (c.seccionCartaId === null ? [] : [c.seccionCartaId])));

      // Los nombres de las secciones nuevas, para la descripción de la auditoría (los de las que se van salen de los cupos de antes).
      const nombresDeSecciones = new Map<string, string>();
      if (seccionIds.size) {
        const secciones = await tx.seccionCarta.findMany({ where: { id: { in: [...seccionIds] } }, select: { id: true, nombre: true } });
        if (secciones.length !== seccionIds.size) return fracaso("SECCION_NO_ENCONTRADA", "Alguna sección de carta de los cupos no existe.");
        for (const s of secciones) nombresDeSecciones.set(s.id, s.nombre);
      }
      if (cuposValidados.length) {
        // D3: peor caso = todos los cupos en su máximo — el precio tiene que alcanzar el piso de $0,01 por unidad ahí también,
        // no solo en la elección mínima. GO-3b: cuentan los cupos de todos los tipos (un componente fijo cuenta como su máximo).
        // Vale para el precio de la empresa y para el precio local de CUALQUIER sucursal que lo tenga.
        const piso = pisoDePrecioDePromo(cuposValidados)!;
        if (Number(promo.precio) < piso.minimo) return fracaso("BAJO_EL_PISO", mensajePisoDePromo(promo.titulo, Number(promo.precio), piso));
        // El precio local de otra sucursal puede ser de una que quien guarda no ve: el rechazo no nombra ni el importe ni la sucursal.
        if (promo.sucursales.some((s) => s.precioLocal !== null && Number(s.precioLocal) < piso.minimo)) {
          return fracaso("BAJO_EL_PISO", mensajePisoLocalDePromo(promo.titulo, piso));
        }
      }

      // GO-3b (D3): TODOS los cupos de la promo, activos y dados de baja (la diferencia es por clave natural; un nombre dado de baja se reactiva, no se duplica).
      const existentes: (CupoExistente & { nombreDeSeccion: string | null })[] = (
        await tx.promoCartaCupo.findMany({
          where: { promoCartaId },
          orderBy: [{ orden: "asc" }, { id: "asc" }],
          select: { id: true, tipo: true, activo: true, seccionCartaId: true, nombre: true, cantidadMinima: true, cantidadMaxima: true, orden: true, seccionCarta: { select: { nombre: true } } },
        })
      ).map((c) => ({ ...c, tipo: c.tipo as TipoDeCupo, nombreDeSeccion: c.seccionCarta?.nombre ?? null }));
      for (const c of existentes) if (c.seccionCartaId !== null && c.nombreDeSeccion !== null && !nombresDeSecciones.has(c.seccionCartaId)) nombresDeSecciones.set(c.seccionCartaId, c.nombreDeSeccion);

      const diferencia = diferenciaDeCupos(existentes, cuposValidados);
      if (!diferencia.ok) return fracaso("CUPO_INVALIDO", diferencia.mensaje);
      // Interruptor del menú del día (`MENU_DEL_DIA_VISIBLE`, decisión del dueño 2026-10-20): apagado, no se suma un lugar del día (nuevo o reactivado), aunque el pedido venga armado a mano.
      const menuDelDiaApagado = lugarDelDiaApagado(diferencia.diferencia, MENU_DEL_DIA_VISIBLE);
      if (menuDelDiaApagado) return fracaso("CUPO_INVALIDO", menuDelDiaApagado);
      const { crear, cambiar, darDeBaja } = diferencia.diferencia;

      // GO-3b (D-2): todos los componentes POSIBLES del combo con los lugares pedidos (los productos de sus secciones, las opciones activas de sus listas y los platos del día de hoy en adelante)
      // no pueden mezclar alícuotas de IVA declaradas distintas. Un lugar nuevo todavía no tiene opciones: cuenta lo que ya existe con su clave.
      const existentePorClave = new Map(existentes.map((c) => [claveNaturalDeCupo(c), c.id]));
      const idsDe = (tipo: TipoDeCupo) => cuposValidados.filter((c) => c.tipo === tipo).flatMap((c) => existentePorClave.get(claveNaturalDeCupo(c)) ?? []);
      const alicuotas = await revisarAlicuotasEnTx(tx, {
        lugares: { seccionCartaIds: [...seccionIds], cupoListaIds: idsDe("LISTA"), cupoDelDiaIds: idsDe("DEL_DIA") },
        desdeDia: diaDeCalendario(actor.ahora, actor.empresaZonaHoraria),
        sucursalIds: await sucursalesDeLaEmpresa(tx, actor.empresaId),
        producto: null,
      });
      if (!alicuotas.ok) return alicuotas;

      // Todo validado: recién acá se escribe (los rechazos de arriba no dejaron nada). Cada escritura con su auditoría, en esta misma transacción.
      const contexto = { promoCartaId, titulo: promo.titulo, nombresDeSecciones };
      for (const c of darDeBaja) {
        await darDeBajaCupoDePromo(tx, { id: c.id });
        await auditarCupo(tx, actor.usuarioId, contexto, c, c, null);
      }
      for (const { estaba, queda } of cambiar) {
        await cambiarCupoDePromo(tx, { id: estaba.id, nombre: queda.nombre, cantidadMinima: queda.cantidadMinima, cantidadMaxima: queda.cantidadMaxima, orden: queda.orden });
        await auditarCupo(tx, actor.usuarioId, contexto, { id: estaba.id, ...queda }, estaba.activo ? estaba : null, queda);
      }
      for (const c of crear) {
        const { id } = await crearCupoDePromo(tx, { promoCartaId, ...c });
        await auditarCupo(tx, actor.usuarioId, contexto, { id, ...c }, null, c);
      }

      return exito(
        cuposValidados.length
          ? `Cupos de "${promo.titulo}" guardados (${cuposValidados.length}): ahora es una promo armable en el POS.`
          : `"${promo.titulo}" volvió a ser informativa (sin cupos): el POS deja de ofrecerla para armar.`,
        null,
      );
    },
    undefined,
    undefined,
    true,
  );
}

/**
 * S-06: una fila de auditoría por cada columna (`cantidadMinima`, `cantidadMaxima`) de cada cupo que cambia, aparece (anterior `null`) o desaparece (nuevo `null`). Los cupos fijan
 * cuántas unidades de cada sección entran por el precio de la promo: subir un máximo de 2 a 30 cambia cuánta mercadería sale por el mismo importe. En un cupo de SECCIÓN `entidadId` es
 * `${promoCartaId}:${seccionCartaId}` (la clave natural del cupo, la de siempre: hasta GO-3b el reemplazo borraba y recreaba las filas, así que su id no servía). La promo es de la empresa:
 * `sucursalId` null. Va dentro de la transacción de la escritura; un cupo que no cambió no deja fila (`registrarCambioAuditado` ignora el «no cambió»).
 *
 * GO-3b (D3): un cupo dado de baja cuenta como «desaparece» (nuevo `null`) y uno que vuelve de una baja, como «aparece» (anterior `null`): la cadena de cada clave queda igual que con el
 * reemplazo de antes. En un lugar de entradas (LISTA o DEL_DIA) `entidadId` es `${promoCartaId}:${cupoId}` (la fila ya es estable) y la descripción nombra el lugar.
 */
async function auditarCupo(
  tx: Parameters<typeof registrarCambioAuditado>[0],
  actorId: string,
  datos: { promoCartaId: string; titulo: string; nombresDeSecciones: ReadonlyMap<string, string> },
  cupo: CupoPedido & { id: string },
  antes: Pick<CupoPedido, "cantidadMinima" | "cantidadMaxima"> | null,
  despues: Pick<CupoPedido, "cantidadMinima" | "cantidadMaxima"> | null,
): Promise<void> {
  const deSeccion = cupo.tipo === "SECCION" && cupo.seccionCartaId !== null;
  const entidadId = deSeccion ? `${datos.promoCartaId}:${cupo.seccionCartaId}` : `${datos.promoCartaId}:${cupo.id}`;
  const lugar = deSeccion
    ? `cupo de la sección "${datos.nombresDeSecciones.get(cupo.seccionCartaId!) ?? cupo.seccionCartaId}"`
    : `lugar «${cupo.nombre ?? ""}» (${cupo.tipo === "LISTA" ? "lista propia" : "plato del día"})`;
  const columnas = [
    { campo: "cantidadMinima", etiqueta: "cantidad mínima" },
    { campo: "cantidadMaxima", etiqueta: "cantidad máxima" },
  ] as const;
  for (const { campo, etiqueta } of columnas) {
    await registrarCambioAuditado(tx, {
      entidad: "PromoCartaCupo",
      entidadId,
      campo,
      descripcion: `Promo "${datos.titulo}": ${lugar}, ${etiqueta}`,
      valorAnterior: antes?.[campo] ?? null,
      valorNuevo: despues?.[campo] ?? null,
      actorId,
    });
  }
}
