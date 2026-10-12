import { beforeEach, describe, expect, it } from "vitest";
import type { Transaccion } from "../../src/lib/db-tipos";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { aprobarYEnviarTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";
import { actualizarActivoSucursalCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal";

/**
 * P15 (decisión del dueño, 2026-10-11): una sucursal con mercadería en camino no se apaga, y una sucursal apagada no manda ni recibe mercadería nueva. El apagado LEE los traspasos ENVIADA / RECHAZADA_DESTINO
 * de la sucursal y ESCRIBE `Sucursal.activo`; el envío directo y la aprobación de una solicitud LEEN `activo` de las dos puntas (la propia y la de destino) y ESCRIBEN un traspaso ENVIADA. Las dos corren en una
 * transacción SERIALIZABLE: cada una lee lo que la otra escribe, Postgres ve el ciclo y aborta una de las dos, y el reintento (`conTransaccionSerializable`) da el rechazo de negocio. Sin la lectura de la fila
 * propia hay una sola dependencia, no hay ciclo, y el orden «apagar y después enviar» deja un traspaso ENVIADA desde una sucursal apagada, que nadie podría confirmar.
 *
 * Cada orden se arma con DOS transacciones en conexiones distintas del pool y una BARRERA (mismo molde que `test/catalogo/campos-sensibles-concurrencia.test.ts`): la transacción de adentro corre COMPLETA y confirma
 * entre dos lecturas de la de afuera, cuya foto de la base ya está tomada. La barrera de los envíos y de la aprobación se dispara tras su PRIMERA lectura de `Sucursal` (la propia), antes de leer la de destino.
 *
 * Mutaciones (ver el informe de P15-3): quitar la lectura de la sucursal propia del envío deja un ENVIADA desde una sucursal apagada (rojo en «apagar el origen»); quitar el chequeo del destino de la aprobación deja
 * un ENVIADA hacia una sucursal apagada (rojo en «apagar el destino contra la aprobación»).
 */
const AHORA_FIJO = new Date("2020-01-01T12:00:00Z");

describe("envío directo y aprobación contra el apagado de una sucursal (P15)", () => {
  let sucursalAId: string; // la que envía
  let sucursalBId: string; // el destino
  let seccionAId: string;
  let seccionBId: string;
  let adminAId: string;
  let adminBId: string;
  let productoId: string;

  /** Un `Transaccion` que, tras la PRIMERA llamada a `tabla.metodo` dentro de la transacción, espera a `entre` (la barrera: la otra operación corre completa y confirma en otra conexión). */
  function transaccionConBarrera(base: Transaccion, tabla: "sucursal" | "traspasoSucursal", metodo: "findUnique" | "findMany", entre: () => Promise<void>) {
    const estado = { disparada: false };
    const transaccion: Transaccion = (async (fn: Parameters<Transaccion>[0], opciones?: Parameters<Transaccion>[1]) =>
      base(async (tx) => {
        const delegado = (tx as unknown as Record<string, Record<string, unknown>>)[tabla]!;
        const delegadoConBarrera = new Proxy(delegado, {
          get(objetivo, propiedad) {
            const valor = objetivo[propiedad as string];
            if (propiedad === metodo && typeof valor === "function") {
              return async (...argumentos: unknown[]) => {
                const leido = await (valor as (...a: unknown[]) => Promise<unknown>).apply(objetivo, argumentos);
                if (!estado.disparada) {
                  estado.disparada = true;
                  await entre();
                }
                return leido;
              };
            }
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        const txConBarrera = new Proxy(tx, {
          get(objetivo, propiedad) {
            if (propiedad === tabla) return delegadoConBarrera;
            const valor = (objetivo as unknown as Record<string | symbol, unknown>)[propiedad];
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        return fn(txConBarrera);
      }, opciones)) as Transaccion;
    return { transaccion, estado };
  }

  // Quien envía está parado en A. Quien apaga está parado en la OTRA sucursal (nadie apaga la suya), así que cada una tiene su admin.
  // Cada actor opera con el alcance que tiene en producción (ADR-028): escritura solo en SU sucursal y lectura ya ENSANCHADA a las dos (la lectura de verificación que el envío, la aprobación y el apagado abren sobre su
  // transacción). Se le da de entrada, en el contexto Y en la transacción, porque el ensanche arma una base NUEVA cuando agranda el alcance y descartaría la transacción con barrera que inyecta este test; con el alcance
  // ya completo devuelve el contexto tal cual. Sin la lectura de la otra punta, el envío no ve a la sucursal contraria y el apagado no ve sus traspasos (fallaría abierto).
  const baseDeA = () => baseDeTest({ lectura: [sucursalAId, sucursalBId], escritura: [sucursalAId] });
  const baseDeB = () => baseDeTest({ lectura: [sucursalAId, sucursalBId], escritura: [sucursalBId] });

  const enviarDesdeA = (transaccion: Transaccion) =>
    crearEnvioDirectoDeTraspasoCasoDeUso(
      { ...baseDeA(), empresaId: EMPRESA_POR_DEFECTO_ID, usuarioId: adminAId, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: AHORA_FIJO, transaccion },
      { destinoSucursalId: sucursalBId, productoId, cantidad: 4, seccionOrigenId: seccionAId, detalle: null },
    );
  const aprobarDesdeA = (transaccion: Transaccion, traspasoId: string) =>
    aprobarYEnviarTraspasoCasoDeUso({ ...baseDeA(), empresaId: EMPRESA_POR_DEFECTO_ID, usuarioId: adminAId, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: AHORA_FIJO, transaccion }, { traspasoId, seccionOrigenId: seccionAId });
  const apagarA = (transaccion: Transaccion) =>
    actualizarActivoSucursalCasoDeUso({ ...baseDeB(), usuarioId: adminBId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursalBId, transaccion }, { sucursalId: sucursalAId, activo: false });
  const apagarB = (transaccion: Transaccion) =>
    actualizarActivoSucursalCasoDeUso({ ...baseDeA(), usuarioId: adminAId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: sucursalAId, transaccion }, { sucursalId: sucursalBId, activo: false });

  const activo = async (id: string) => (await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id } })).activo;
  const traspasosEnviados = () => prismaAdmin.traspasoSucursal.count({ where: { estado: "ENVIADA" } });
  const salidasEscritas = () => prismaAdmin.operacion.count({ where: { proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminAId = (await crearUsuarioConMembresia({ email: "admin-a@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    adminBId = (await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: sucursalBId, rolId: base.admin.id })).id;
    const catalogo = await sembrarCatalogoBase();
    const harina = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } });
    productoId = harina.id;
    await prisma.disponibilidadProducto.createMany({ data: [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId, disponible: true })) });
    const compra = await prisma.operacion.create({ data: { sucursalId: sucursalAId, proceso: "COMPRA", fecha: AHORA_FIJO, usuarioId: adminAId } });
    await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId, seccionId: seccionAId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 } });
  });

  describe("envío directo", () => {
    it("apagar el ORIGEN entre la lectura y la escritura del envío → el envío reintenta y recibe SUCURSAL_INACTIVA; A queda apagada, sin ENVIADA ni SALIDA", async () => {
      let apagado: Awaited<ReturnType<typeof apagarA>> | undefined;
      const { transaccion, estado } = transaccionConBarrera(baseDeA().transaccion, "sucursal", "findUnique", async () => {
        apagado = await apagarA(baseDeB().transaccion);
      });

      const envio = await enviarDesdeA(transaccion);

      expect(estado.disparada).toBe(true);
      expect(apagado, "el apagado corrió entero dentro de la barrera").toMatchObject({ ok: true });
      expect(envio).toEqual({ ok: false, codigo: "SUCURSAL_INACTIVA", mensaje: 'Tu sucursal "Central" está desactivada: no se pueden enviar traspasos desde ella.' });
      expect(await activo(sucursalAId)).toBe(false);
      expect(await traspasosEnviados()).toBe(0);
      expect(await salidasEscritas()).toBe(0);
    });

    it("el envío confirma entre la lectura y la escritura del apagado del ORIGEN → el apagado reintenta y recibe TIENE_PENDIENTES; A queda activa con su ENVIADA", async () => {
      let envio: Awaited<ReturnType<typeof enviarDesdeA>> | undefined;
      const { transaccion, estado } = transaccionConBarrera(baseDeB().transaccion, "traspasoSucursal", "findMany", async () => {
        envio = await enviarDesdeA(baseDeA().transaccion);
      });

      const apagado = await apagarA(transaccion);

      expect(estado.disparada).toBe(true);
      expect(envio, "el envío corrió entero dentro de la barrera").toMatchObject({ ok: true });
      expect(apagado).toMatchObject({ ok: false, codigo: "TIENE_PENDIENTES" });
      expect(apagado.mensaje).toContain('"Sucursal B" tiene que recibir o rechazar el traspaso de 4 kg de "Harina"');
      expect(await activo(sucursalAId)).toBe(true);
      expect(await traspasosEnviados()).toBe(1);
    });

    it("apagar el DESTINO entre la lectura y la escritura del envío → el envío reintenta y recibe SUCURSAL_NO_DISPONIBLE; B queda apagada, sin ENVIADA ni SALIDA", async () => {
      let apagado: Awaited<ReturnType<typeof apagarB>> | undefined;
      const { transaccion, estado } = transaccionConBarrera(baseDeA().transaccion, "sucursal", "findUnique", async () => {
        apagado = await apagarB(baseDeA().transaccion);
      });

      const envio = await enviarDesdeA(transaccion);

      expect(estado.disparada).toBe(true);
      expect(apagado, "el apagado corrió entero dentro de la barrera").toMatchObject({ ok: true });
      expect(envio).toEqual({ ok: false, codigo: "SUCURSAL_NO_DISPONIBLE", mensaje: "Esa sucursal no existe o no está activa." });
      expect(await activo(sucursalBId)).toBe(false);
      expect(await traspasosEnviados()).toBe(0);
      expect(await salidasEscritas()).toBe(0);
    });
  });

  describe("aprobación de una solicitud", () => {
    /** Una solicitud PULL de B a A, SOLICITADA (no movió stock: no impide apagar B). */
    const solicitud = () =>
      prisma.traspasoSucursal.create({
        data: { origenSucursalId: sucursalAId, destinoSucursalId: sucursalBId, productoId, cantidad: 4, seccionDestinoId: seccionBId, iniciadoPor: "DESTINO", estado: "SOLICITADA", creadoPorId: adminBId },
      });

    it("apagar el DESTINO entre la lectura y la escritura de la aprobación → la aprobación reintenta y recibe SUCURSAL_NO_DISPONIBLE; la solicitud sigue SOLICITADA y no sale stock", async () => {
      const sol = await solicitud();
      let apagado: Awaited<ReturnType<typeof apagarB>> | undefined;
      const { transaccion, estado } = transaccionConBarrera(baseDeA().transaccion, "sucursal", "findUnique", async () => {
        apagado = await apagarB(baseDeA().transaccion);
      });

      const aprobacion = await aprobarDesdeA(transaccion, sol.id);

      expect(estado.disparada).toBe(true);
      expect(apagado, "el apagado corrió entero dentro de la barrera (una SOLICITADA no lo impide)").toMatchObject({ ok: true });
      expect(aprobacion).toEqual({ ok: false, codigo: "SUCURSAL_NO_DISPONIBLE", mensaje: "Esa sucursal no existe o no está activa." });
      expect(await activo(sucursalBId)).toBe(false);
      expect((await prismaAdmin.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).estado).toBe("SOLICITADA");
      expect(await traspasosEnviados()).toBe(0);
      expect(await salidasEscritas()).toBe(0);
    });

    it("apagar el ORIGEN entre la lectura y la escritura de la aprobación → la aprobación reintenta y recibe SUCURSAL_INACTIVA; la solicitud sigue SOLICITADA y no sale stock", async () => {
      const sol = await solicitud();
      let apagado: Awaited<ReturnType<typeof apagarA>> | undefined;
      const { transaccion, estado } = transaccionConBarrera(baseDeA().transaccion, "sucursal", "findUnique", async () => {
        apagado = await apagarA(baseDeB().transaccion);
      });

      const aprobacion = await aprobarDesdeA(transaccion, sol.id);

      expect(estado.disparada).toBe(true);
      expect(apagado, "el apagado corrió entero dentro de la barrera").toMatchObject({ ok: true });
      expect(aprobacion).toEqual({ ok: false, codigo: "SUCURSAL_INACTIVA", mensaje: 'Tu sucursal "Central" está desactivada: no se pueden enviar traspasos desde ella.' });
      expect(await activo(sucursalAId)).toBe(false);
      expect((await prismaAdmin.traspasoSucursal.findUniqueOrThrow({ where: { id: sol.id } })).estado).toBe("SOLICITADA");
      expect(await salidasEscritas()).toBe(0);
    });
  });
});
