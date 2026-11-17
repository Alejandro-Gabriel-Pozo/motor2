import "server-only";
import { decidirAltaDeMedio, nombreDeConfiguracionValido, tipoDeMedioValido } from "@/core/caja/public";
import type { ComandoCrearMedioDePago, ResultadoCrearMedioDePago } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarEfectivoDeLaEmpresa, cargarMedioPorNombre, cargarMedioSinNombre, insertarMedio } from "@/server/persistencia/caja/configuracion";

/**
 * Caso de uso «crear un medio de pago» (etapa C3; Pedernal `crearMedioDePago`): uno de los seis tipos (el TIPO es inmutable). Nace activo y SIN pedir ningún dato extra (todo nace cerrado; `editarMedioDePago` los habilita).
 * Hay un solo efectivo por empresa; en C1 ya nace solo al abrir la primera sesión.
 *
 * `import "server-only"` y SIN `"use server"`. Valida el tipo y el nombre (lista de permitidos) y en UNA transacción SERIALIZABLE decide (`decidirAltaDeMedio`): el mismo medio ya activo (mismo tipo y nombre; sin nombre, mismo
 * tipo) → `yaExistia` sin escribir ni auditar; el nombre lo usa un medio de otro tipo → `MEDIO_DUPLICADO`; uno desactivado → `MEDIO_INACTIVO_CON_ESE_NOMBRE` (se lo reactiva); ya hay efectivo y se pide otro →
 * `EFECTIVO_YA_EXISTE`; si no, inserta y audita. Segunda barrera: los índices únicos del efectivo, del nombre sin mayúsculas y del medio sin nombre por tipo.
 *
 * @contract Deja exactamente un medio por tipo y nombre, o no escribe nada.
 * @idempotency Por estado (como Pedernal): el mismo medio activo ya creado devuelve `yaExistia`; dos altas iguales a la vez dejan uno (la perdedora, tras el reintento serializable, ve el primero).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el alta con su tipo y nombre).
 * @ficha permiso=medios_de_pago_crear transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function crearMedioDePagoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion" | "ahora">,
  comando: ComandoCrearMedioDePago,
  azar: FuenteDeAzar,
): Promise<ResultadoCrearMedioDePago> {
  const tipo = tipoDeMedioValido(comando.tipo);
  if (!tipo.ok) return fracaso(tipo.error, "El tipo de medio de pago no es válido.");
  let nombreDelMedio: string | null = null;
  if (comando.nombre !== null) {
    const nombre = nombreDeConfiguracionValido(comando.nombre);
    if (!nombre.ok) return fracaso("NOMBRE_DE_MEDIO_INVALIDO", "El nombre del medio de pago no es válido.");
    nombreDelMedio = nombre.valor;
  }

  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoCrearMedioDePago> => {
      const conEseNombre = nombreDelMedio === null ? await cargarMedioSinNombre(tx, actor.empresaId, tipo.valor) : await cargarMedioPorNombre(tx, actor.empresaId, nombreDelMedio);
      const efectivo = tipo.valor === "EFECTIVO" ? await cargarEfectivoDeLaEmpresa(tx, actor.empresaId) : null;
      const decision = decidirAltaDeMedio({ tipo: tipo.valor, nombre: nombreDelMedio }, { conEseNombre, efectivo });
      if (!decision.ok) return fracaso(decision.error, "Ya hay un medio de pago con ese nombre o tipo.");
      if (decision.valor === "YA_EXISTIA") {
        const existente = tipo.valor === "EFECTIVO" ? efectivo : conEseNombre;
        if (existente === null) throw new Error("crearMedioDePago: ya existía un medio nulo.");
        return exito("El medio de pago ya estaba creado.", { medioDePagoId: existente.id, yaExistia: true });
      }

      const id = azar.uuid();
      await insertarMedio(tx, { id, empresaId: actor.empresaId, tipo: tipo.valor, nombre: nombreDelMedio, ahora: actor.ahora });
      await registrarCambioAuditado(tx, {
        entidad: "MedioDePago",
        entidadId: id,
        descripcion: `Medio de pago creado: ${nombreDelMedio ?? tipo.valor} (${tipo.valor})`,
        campo: "alta",
        valorAnterior: null,
        valorNuevo: "activo",
        actorId: actor.usuarioId,
        sucursalId: null,
      });
      return exito("Medio de pago creado.", { medioDePagoId: id, yaExistia: false });
    },
    undefined,
    undefined,
    true,
  );
}
