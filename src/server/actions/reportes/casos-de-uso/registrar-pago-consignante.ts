import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import type { ComandoRegistrarPagoConsignante, ResultadoRegistrarPagoConsignante } from "@/core/features/reportes/pago-consignante.schema";
import { cargarPagoConsignantePorClave, cargarProveedorActivo, crearPagoConsignante } from "@/server/persistencia/reportes/pago-consignante";

/**
 * Caso de uso «registrar un pago a un proveedor de consignación» (Task #41, Fase M, M14 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que antes vivía en línea en la Server Action
 * `registrarPagoConsignante` (src/server/actions/reportes/consignacion.ts); la Server Action quedó como adaptador fino
 * (permiso → guard de comando → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo
 * `conPermiso("pagar_consignante")`) ni el formato del comando (`guardComandoRegistrarPagoConsignante`): recibe `comando` ya pasado
 * por esa.
 *
 * A diferencia de `registrarMovimiento`/`reclasificarStock` (Kardex, con un invariante de agregado real que proteger bajo
 * concurrencia), acá NO hace falta `conTransaccionSerializable`: la única carrera posible es "insert duplicado bajo la misma clave
 * I3", que el índice único de `PagoConsignante.claveIdempotencia` + un `prisma.$transaction` SIMPLE ya resuelven — si dos requests
 * concurrentes con la MISMA clave corren la carrera, una gana el insert y la otra recibe un P2002, que se atrapa más abajo.
 *
 * Orden:
 *  1. si hay `claveIdempotencia`: `cargarPagoConsignantePorClave` — mismo payload (mismo hash) y ya resuelto → éxito repetido, sin
 *     volver a escribir nada; distinto hash → conflicto;
 *  2. `cargarProveedorActivo` — no existe o inactivo → el mismo mensaje de siempre;
 *  3. el mensaje de éxito se arma ANTES del insert (Opción B: proveedor e importe ya se conocen, a diferencia de `Operacion`, donde
 *     el mensaje puede depender de algo escrito después en la misma transacción);
 *  4. `crearPagoConsignante` con `resultadoMensaje` ya adentro (un solo `create`, sin `update` posterior);
 *  5. `registrarCambioAuditado` (paso 2, campo "importe", valorAnterior null — mismo criterio de "creación" que `RecetaVersion` en
 *     `guardar-version-de-receta.ts`, P1): antes `registrarPagoConsignante` no dejaba ningún rastro de quién pagó qué.
 *
 * @contract Registra un pago a un proveedor de consignación exactamente una vez por claveIdempotencia, con auditoría.
 * @idempotency I3 (claveIdempotencia + payloadHash) — índice único + catch de P2002, no conTransaccionSerializable (sin invariante de agregado que proteger bajo concurrencia).
 * @transaction prisma.$transaction simple (no SERIALIZABLE — la única carrera posible es el insert duplicado, que resuelve el índice único de PagoConsignante.claveIdempotencia).
 * @sideEffects registrarCambioAuditado (campo importe).
 */
export async function registrarPagoConsignanteCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId">,
  comando: ComandoRegistrarPagoConsignante
): Promise<ResultadoRegistrarPagoConsignante> {
  const payloadHash = comando.claveIdempotencia
    ? calcularPayloadHash("PAGO_CONSIGNANTE", actor.sucursalId, { ...comando, claveIdempotencia: undefined })
    : "";

  try {
    return await prisma.$transaction(async (tx): Promise<ResultadoRegistrarPagoConsignante> => {
      if (comando.claveIdempotencia) {
        const existente = await cargarPagoConsignantePorClave(tx, comando.claveIdempotencia);
        if (existente) {
          if (existente.payloadHash === payloadHash && existente.resultadoMensaje !== null) {
            return exito(existente.resultadoMensaje, { pagoId: null, repetido: true });
          }
          return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
        }
      }

      const proveedor = await cargarProveedorActivo(tx, comando.proveedorId);
      if (!proveedor) return fracaso("PROVEEDOR_NO_ENCONTRADO", "No se encontró el proveedor, o está inactivo.");

      const mensaje = `Pago de $${comando.importe.toLocaleString("es-AR")} a "${proveedor.nombre}" registrado.`;

      const pago = await crearPagoConsignante(tx, {
        sucursalId: actor.sucursalId,
        proveedorId: comando.proveedorId,
        importe: comando.importe,
        fecha: comando.fecha,
        notas: comando.notas,
        usuarioId: actor.usuarioId,
        claveIdempotencia: comando.claveIdempotencia ?? null,
        payloadHash: comando.claveIdempotencia ? payloadHash : null,
        resultadoMensaje: comando.claveIdempotencia ? mensaje : null,
      });

      await registrarCambioAuditado(tx, {
        entidad: "PagoConsignante",
        entidadId: pago.id,
        campo: "importe",
        descripcion: `Pago a "${proveedor.nombre}" registrado`,
        valorAnterior: null,
        valorNuevo: comando.importe,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });

      return exito(mensaje, { pagoId: pago.id, repetido: false });
    });
  } catch (e) {
    // Carrera real (dos requests concurrentes con la MISMA claveIdempotencia): uno gana el insert, el otro choca contra el
    // `@@unique` — se relee fuera de la transacción fallida y, si el ganador ya dejó su resultadoMensaje, se devuelve como éxito
    // repetido. Fail closed (mismo criterio que el resto de I3): si no se puede confirmar qué pasó, se relanza el error.
    if (comando.claveIdempotencia && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ganador = await prisma.pagoConsignante.findUnique({
        where: { claveIdempotencia: comando.claveIdempotencia },
        select: { resultadoMensaje: true },
      });
      if (ganador?.resultadoMensaje) return exito(ganador.resultadoMensaje, { pagoId: null, repetido: true });
    }
    throw e;
  }
}
