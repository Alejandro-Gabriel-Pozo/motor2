import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { mensajePisoDePromo, mensajePisoLocalDePromo, pisoDePrecioDePromo } from "@/core/carta/piso-de-promo";
import { claveNaturalDeCupo, motivoDeParteSinPlatos, planDeParte, type CupoExistenteConSeccion, type TipoDeCupo } from "@/core/carta/public";
import type { ComandoGuardarParteDePromo, ResultadoGuardarParteDePromo } from "@/core/features/carta/promos.schema";
import { exito, fracaso, type Fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { cargarLugaresActivosDePromo, sucursalesDeLaEmpresa } from "@/server/lecturas/carta/componentes-de-promo";
import { actualizarActivaEntradaDeCupoEnTx } from "./actualizar-activa-entrada-de-cupo";
import { agregarEntradaDeCupoEnTx } from "./agregar-entrada-de-cupo";
import { revisarAlicuotasEnTx } from "./componentes-de-combo-en-tx";
import { aplicarOperacionDeCupo } from "./guardar-cupos-promo-carta";

type FracasoDeLaParte = Fracaso<Extract<ResultadoGuardarParteDePromo, { ok: false }>["codigo"]>;

/**
 * Un rechazo de las reglas de negocio, LANZADO. Dentro de `conTransaccionSerializable` devolver un `fracaso` NO deshace lo ya escrito (Prisma confirma lo que la función terminó sin lanzar): el cupo y los platos de la parte son
 * UNA sola unidad (I11), así que todo rechazo posterior a la primera escritura se lanza y se captura afuera, con la transacción ya deshecha (el mismo recurso que `crear-grupo-en-el-producto.ts`).
 */
class ParteRechazada extends Error {
  constructor(readonly resultado: FracasoDeLaParte) {
    super(resultado.mensaje);
    this.name = "ParteRechazada";
  }
}

/** Un rechazo de un paso compartido (un plato como componente) como rechazo de este comando: los códigos que el comando no declara salen como `CONFIGURACION_INVALIDA`. */
function rechazoDe(paso: { codigo: string; mensaje: string }): ParteRechazada {
  const conocidos = ["PRODUCTO_NO_ENCONTRADO", "PRODUCTO_INVALIDO", "COMPONENTE_SIN_PRECIO_DE_REFERENCIA", "COMPONENTE_SIN_RECETA", "CONFIGURACION_INVALIDA", "COMBO_ALICUOTAS_DISTINTAS", "CUPO_INVALIDO"] as const;
  const codigo = conocidos.find((c) => c === paso.codigo);
  return new ParteRechazada(fracaso(codigo ?? "CONFIGURACION_INVALIDA", paso.mensaje));
}

/**
 * Caso de uso «llevar UNA parte de una promo al estado pedido» (E2a de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`; necesidad: pedido del dueño del 2026-11-11 y su confirmación del 2026-11-17). Una parte es una sección de la carta o una lista con
 * nombre («No está en la carta»): `NO_ENTRA`, `TODA` («Toda la sección», cupo SECCION) o `SOLO_ESTOS` («Solo estos platos»: cupo LISTA con el nombre de la sección y los platos tildados como entradas, cada uno fijo o «el mozo elige»). Cambiar de «Toda» a «Solo
 * estos» (y al revés) es todo o nada: el cupo, las bajas y los platos van en UNA transacción SERIALIZABLE (I11). La promo y los cupos se leen ADENTRO; el piso de $0,01 por unidad del peor caso se mide sobre TODAS las partes de la promo
 * (el precio de la empresa y el local de cualquier sucursal); una parte «Solo estos platos» sin ningún plato y con mínimo mayor a 0 se bloquea (I12b, CONFIRMADA); las alícuotas de IVA del combo no se mezclan (D-2).
 *
 * Reutiliza, sin duplicar reglas, el cuerpo de `agregarEntradaDeCupo` y de `actualizarActivaEntradaDeCupo` (`…EnTx`) y la diferencia por clave natural de los cupos (`planDeParte`, la misma de `guardarCuposPromoCarta`). El conjunto de platos que llega es
 * el FINAL: los que ya estaban y no vinieron se dan de baja (nunca se borra); los que vuelven se reactivan. Una parte «Toda la sección» no toca los platos de su lista (quedan guardados por si vuelve). Cada escritura deja su fila de auditoría en la misma
 * transacción: el cupo con `auditarCupo` (cantidades, quién y cuándo por la fila) y cada plato con `EntradaDeCupo.activa`.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. El permiso `carta_promo_definir` y el formato (`guardComandoGuardarParteDePromo`) ya los resolvió la Server Action.
 *
 * @contract Deja la parte como se pide (cupo y platos), con su auditoría, o no escribe nada: ante cualquier rechazo (también el de un plato, posterior al cupo) no queda ni una fila.
 * @idempotency Por estado — repetir el pedido no escribe ni audita nada; dos guardados a la vez de la misma parte dejan un estado válido (el único de la clave natural del cupo y del plato, y el reintento relee).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, con `tambienChoqueDeUnico`): las lecturas que deciden, el cupo, sus platos y la auditoría, juntos; todo rechazo posterior a la primera escritura lanza para deshacer.
 * @sideEffects registrarCambioAuditado (`PromoCartaCupo` por columna y `EntradaDeCupo.activa`), con el mismo `tx`; ninguno fuera de la base, así que el reintento es seguro.
 * @ficha permiso=carta_promo_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarParteDePromoCasoDeUso(
  actor: Pick<ContextoDeAccion, "transaccion" | "usuarioId" | "empresaId" | "sucursalId" | "db" | "alcance" | "ahora" | "empresaZonaHoraria">,
  comando: ComandoGuardarParteDePromo,
): Promise<ResultadoGuardarParteDePromo> {
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  try {
    return await conTransaccionSerializable(
      verificacion.transaccion,
      async (tx): Promise<ResultadoGuardarParteDePromo> => {
        const promo = await tx.promoCarta.findUnique({ where: { id: comando.promoCartaId }, include: { sucursales: { select: { precioLocal: true } } } });
        if (!promo) return fracaso("PROMO_NO_ENCONTRADA", "No se encontró la promo.");

        let nombreDeSeccion: string | null = null;
        if (comando.lugar.tipo === "SECCION") {
          const seccion = await tx.seccionCarta.findUnique({ where: { id: comando.lugar.seccionCartaId }, select: { nombre: true } });
          if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "La sección de carta de la parte no existe.");
          nombreDeSeccion = seccion.nombre;
        }

        // TODOS los cupos de la promo, activos y dados de baja (la diferencia es por clave natural; un nombre dado de baja sigue ocupado y se reactiva, no se duplica).
        const existentes: CupoExistenteConSeccion[] = (
          await tx.promoCartaCupo.findMany({
            where: { promoCartaId: promo.id },
            orderBy: [{ orden: "asc" }, { id: "asc" }],
            select: { id: true, tipo: true, activo: true, seccionCartaId: true, nombre: true, cantidadMinima: true, cantidadMaxima: true, orden: true, seccionCarta: { select: { nombre: true } } },
          })
        ).map((c) => ({ ...c, tipo: c.tipo as TipoDeCupo, nombreDeSeccion: c.seccionCarta?.nombre ?? null }));

        const plan = planDeParte(existentes, {
          lugar: comando.lugar.tipo === "SECCION" ? { tipo: "SECCION", seccionCartaId: comando.lugar.seccionCartaId, nombreDeSeccion: nombreDeSeccion ?? "" } : comando.lugar,
          modo: comando.modo,
          cantidadMinima: comando.cantidadMinima,
          cantidadMaxima: comando.cantidadMaxima,
        });
        if (!plan.ok) return fracaso("CUPO_INVALIDO", plan.mensaje);
        const sinPlatos = motivoDeParteSinPlatos(comando.modo, comando.cantidadMinima, comando.entradas.length);
        if (sinPlatos) return fracaso("CUPO_INVALIDO", sinPlatos);

        // D3: peor caso = todos los cupos en su máximo, ahora con esta parte. Vale para el precio de la empresa y el local de CUALQUIER sucursal que lo tenga (la verificación ve toda la empresa).
        const piso = pisoDePrecioDePromo(plan.cuposFinales);
        if (piso) {
          if (Number(promo.precio) < piso.minimo) return fracaso("BAJO_EL_PISO", mensajePisoDePromo(promo.titulo, Number(promo.precio), piso));
          if (promo.sucursales.some((s) => s.precioLocal !== null && Number(s.precioLocal) < piso.minimo)) return fracaso("BAJO_EL_PISO", mensajePisoLocalDePromo(promo.titulo, piso));
        }

        // Todo validado de lo que se ve sin escribir: de acá en más, todo rechazo se LANZA (deshace).
        const nombresDeSecciones = new Map<string, string>();
        for (const c of existentes) if (c.seccionCartaId !== null && c.nombreDeSeccion !== null) nombresDeSecciones.set(c.seccionCartaId, c.nombreDeSeccion);
        if (comando.lugar.tipo === "SECCION" && nombreDeSeccion !== null) nombresDeSecciones.set(comando.lugar.seccionCartaId, nombreDeSeccion);
        const contexto = { promoCartaId: promo.id, titulo: promo.titulo, nombresDeSecciones };
        let cupoDeLosPlatos: string | null = plan.claveDeLaLista === null ? null : (existentes.find((c) => claveNaturalDeCupo(c) === plan.claveDeLaLista)?.id ?? null);
        let huboCambio = plan.operaciones.length > 0;
        for (const o of plan.operaciones) {
          const id = await aplicarOperacionDeCupo(tx, actor.usuarioId, contexto, o);
          if (o.op === "CREAR" && o.cupo.tipo === "LISTA" && comando.modo === "SOLO_ESTOS") cupoDeLosPlatos = id;
        }

        if (comando.modo === "TODA") {
          // D-2: todos los componentes POSIBLES del combo con esta sección (y los demás lugares activos) no mezclan alícuotas declaradas distintas.
          const alicuotas = await revisarAlicuotasEnTx(tx, {
            lugares: await cargarLugaresActivosDePromo(tx, promo.id),
            sucursalIds: await sucursalesDeLaEmpresa(tx, actor.empresaId),
            producto: null,
          });
          if (!alicuotas.ok) throw rechazoDe(alicuotas);
        }

        if (comando.modo === "SOLO_ESTOS") {
          if (cupoDeLosPlatos === null) throw new ParteRechazada(fracaso("CUPO_INVALIDO", "No se encontró el lugar de la parte para cargarle los platos."));
          const quedan = new Set<string>();
          for (const plato of comando.entradas) {
            const r = await agregarEntradaDeCupoEnTx(tx, actor, { cupoId: cupoDeLosPlatos, productoId: plato.productoId, modoDeOpciones: plato.modoDeOpciones, opciones: plato.opciones });
            if (!r.ok) throw rechazoDe(r);
            quedan.add(r.datos.entradaId);
            if (r.datos.huboCambio) huboCambio = true;
          }
          // El conjunto es el FINAL: lo que estaba activo y no vino se da de baja.
          const activas = await tx.entradaDeCupo.findMany({ where: { cupoId: cupoDeLosPlatos, activa: true }, select: { id: true } });
          for (const { id } of activas) {
            if (quedan.has(id)) continue;
            const r = await actualizarActivaEntradaDeCupoEnTx(tx, actor, { entradaId: id, activa: false });
            if (!r.ok) throw rechazoDe(r);
            if (r.datos.huboCambio) huboCambio = true;
          }
        }

        const que = comando.modo === "NO_ENTRA" ? "no entra en la promo" : comando.modo === "TODA" ? "entra entera" : `entra con ${comando.entradas.length} plato${comando.entradas.length === 1 ? "" : "s"}`;
        const lugar = comando.lugar.tipo === "SECCION" ? `«${nombreDeSeccion ?? ""}»` : `«${comando.lugar.nombre}»`;
        return exito(huboCambio ? `${lugar} de «${promo.titulo}»: ${que}.` : `${lugar} de «${promo.titulo}» ya estaba así.`, { huboCambio });
      },
      undefined,
      undefined,
      true,
    );
  } catch (e) {
    if (e instanceof ParteRechazada) return e.resultado;
    throw e;
  }
}
