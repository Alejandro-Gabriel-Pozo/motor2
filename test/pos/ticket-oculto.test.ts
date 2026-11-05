import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { armarComandas } from "../../src/core/pos/comanda";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { obtenerTicketsRecientes } from "../../src/server/consultas/pos/tickets";
import { obtenerDetalleDeMesa } from "../../src/server/consultas/pos/detalle-de-mesa";
import { listarTicketsEmitidos } from "../../src/server/consultas/reportes/tickets-emitidos";
import { CANALES, GRUPOS, NOMBRE_DEL_PLATO, SE_IMPRIME, type CanalDelTicket, type GrupoDelTicket } from "./ticket-oculto.oraculo";

/**
 * El ticket del cliente usa el «Nombre en la carta» y no imprime lo que la carta oculta, CONGELADO al vender (2026-11-05; `docs/diseno-ticket-respeta-lo-oculto-2026-11-04.md`), contra Postgres y contra el
 * oráculo escrito aparte (`ticket-oculto.oraculo.ts`): grupo {oculto sin precio, oculto con precio, visible} × canal {ticket al cerrar, reimpresión tras cambiar la carta, comanda, detalle interno}.
 * Además: la anulación de una línea enviada no cambia el nombre del ticket, y una línea vieja (sin nombre congelado) sigue saliendo con el nombre interno. La idempotencia de «agregar al pedido» la cubre `agregar-items-idempotencia.test.ts`.
 *
 * Mutaciones: sacar el filtro de `ocultaEnCarta` en `configuracionDeItemLeido` rompe OCULTO_SIN_PRECIO × ticket; leer el nombre vigente de la carta en vez del congelado rompe la reimpresión.
 */
const MARCA: Record<GrupoDelTicket, string> = { OCULTO_SIN_PRECIO: "a punto", OCULTO_CON_PRECIO: "almendras", VISIBLE: "papas" };

describe("el ticket del cliente: nombre de la carta y lo oculto, congelados al vender", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let cuentaId: string;
  let grupoPuntoId: string;
  let grupoGuarnicionId: string;

  const db = () => baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;
  const textoDeLinea = (l: { producto: string; detalle?: string | undefined }) => `${l.producto} ${l.detalle ?? ""}`.toLowerCase();
  const cafeDelTicket = async () => {
    const [ticket] = await obtenerTicketsRecientes(s.sucursalId, s.mesa.id, db(), undefined, new Date());
    return ticket!;
  };

  async function incluida(nombreGrupo: string, nombreOpcion: string, orden: number, seMuestraEnCarta: boolean) {
    const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: nombreGrupo, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
    const opcion = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: nombreOpcion, orden: 1 } });
    const version = await prisma.versionDeOpcion.create({ data: { opcionId: opcion.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: c.cafeId, grupoId: grupo.id, orden, seMuestraEnCarta } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: c.cafeId, opcionId: opcion.id } });
    return { grupoId: grupo.id, elegida: elegida({ versionDe: { [opcion.id]: version.id } }, opcion.id) };
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    c = await sembrarCafeDelSalon(s);
    await entrarComo(s.admin);
    // OCULTO_CON_PRECIO: «Leche» (con Almendras +150) apagada en la carta: lo que se cobra nunca se omite. OCULTO_SIN_PRECIO: «Punto» (incluida, sin recargo) apagada. VISIBLE: «Guarnición» a la vista.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoLecheId }, data: { seMuestraEnCarta: false } });
    const punto = await incluida("Punto", "A punto", 3, false);
    const guarnicion = await incluida("Guarnición", "Con papas", 4, true);
    grupoPuntoId = punto.grupoId;
    grupoGuarnicionId = guarnicion.grupoId;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, nombreEnCarta: "Flan casero" } });
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const r = await agregarItems(cuentaId, [
      { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), punto.elegida, guarnicion.elegida] },
      { productoId: s.flan.id, cantidad: 2 },
    ]);
    expect(r.ok, r.mensaje).toBe(true);
    // Una línea «vieja»: sin nombre congelado (como toda anterior a la migración). Sale con el nombre interno.
    await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, creadoPorId: s.admin.id } });
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
  });

  it("al vender se congelan el nombre de la carta (solo del plato directo que lo tiene) y la marca de lo oculto (solo del grupo apagado y sin precio)", async () => {
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId }, include: { opcionesElegidas: true }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    const porProducto = (id: string) => items.find((i) => i.productoId === id)!;
    expect(porProducto(s.flan.id).nombreEnTicket).toBe("Flan casero");
    expect(porProducto(c.cafeId).nombreEnTicket, "el café no tiene nombre en la carta").toBeNull();
    expect(porProducto(s.milanesa.id).nombreEnTicket, "la línea vieja no tiene nada congelado").toBeNull();
    const marcas = Object.fromEntries(porProducto(c.cafeId).opcionesElegidas.map((f) => [f.nombreOpcion, f.ocultaEnCarta]));
    expect(marcas).toEqual({ Grande: false, Almendras: false, "A punto": true, "Con papas": false });
  });

  it("el ORÁCULO: grupo × canal (ticket al cerrar, reimpresión tras cambiar la carta, comanda, detalle interno)", async () => {
    // Los conteos de las dimensiones: un valor nuevo obliga a declarar qué se imprime.
    expect([GRUPOS.length, CANALES.length]).toEqual([3, 4]);

    // DETALLE_INTERNO y COMANDA: antes de cerrar.
    const detalle = await obtenerDetalleDeMesa(s.sucursalId, s.mesa.id, db(), new Date());
    const envio = detalle!.cuenta!.envios[0]!;
    const cafeInterno = envio.items.find((i) => i.productoId === c.cafeId)!;
    const flanInterno = envio.items.find((i) => i.productoId === s.flan.id)!;
    const [comanda] = armarComandas(detalle!.cuenta!.envios, detalle!.cuenta!.mesero);
    const cafeComanda = comanda!.lineas.find((l) => l.producto.toLowerCase().includes("café"))!;
    const flanComanda = comanda!.lineas.find((l) => l.producto.toLowerCase().includes("flan"))!;

    // TICKET_AL_CERRAR.
    const cierre = await cerrarCuenta(cuentaId);
    expect(cierre.ok, cierre.mensaje).toBe(true);
    const alCerrar = await cafeDelTicket();

    // REIMPRESIÓN: la carta cambia DESPUÉS de vender (se muestra «Punto», se oculta «Guarnición», el plato se renombra); el ticket cerrado sigue igual.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: grupoPuntoId }, data: { seMuestraEnCarta: true } });
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: grupoGuarnicionId }, data: { seMuestraEnCarta: false } });
    await prisma.contenidoCartaProducto.updateMany({ where: { sucursalId: s.sucursalId, productoId: s.flan.id }, data: { nombreEnCarta: "Flan de la casa" } });
    const reimpreso = await cafeDelTicket();
    expect(reimpreso, "la reimpresión es idéntica al original").toEqual(alCerrar);
    const emitidos = await listarTicketsEmitidos(s.sucursalId, {}, db());

    const lineaCafe = (t: { lineas: { producto: string; detalle?: string | undefined }[] }) => t.lineas.find((l) => l.producto.toLowerCase().includes("café"))!;
    const lineaFlan = (t: { lineas: { producto: string }[] }) => t.lineas.find((l) => l.producto.toLowerCase().includes("flan"))!;
    const textoPorCanal: Record<CanalDelTicket, string> = {
      TICKET_AL_CERRAR: textoDeLinea(lineaCafe(alCerrar)),
      REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA: textoDeLinea(lineaCafe(reimpreso)),
      COMANDA: textoDeLinea(cafeComanda),
      DETALLE_INTERNO: textoDeLinea({ producto: cafeInterno.nombreDeLinea ?? "", detalle: cafeInterno.detalleDeLinea }),
    };
    for (const grupo of GRUPOS) for (const canal of CANALES) {
      expect(textoPorCanal[canal].includes(MARCA[grupo]), `${grupo} × ${canal}: «${MARCA[grupo]}» en «${textoPorCanal[canal]}»`).toBe(SE_IMPRIME[grupo][canal]);
    }
    const nombrePorCanal: Record<CanalDelTicket, string> = {
      TICKET_AL_CERRAR: lineaFlan(alCerrar).producto,
      REIMPRESION_DESPUES_DE_CAMBIAR_LA_CARTA: lineaFlan(reimpreso).producto,
      COMANDA: flanComanda.producto,
      DETALLE_INTERNO: flanInterno.productoNombre,
    };
    for (const canal of CANALES) expect(nombrePorCanal[canal], `nombre del plato × ${canal}`).toBe(NOMBRE_DEL_PLATO[canal]);
    // Lo que no tiene nada congelado sale como siempre; y «Tickets emitidos» (el reporte) imprime lo mismo que el ticket.
    expect(alCerrar.lineas.map((l) => l.producto)).toContain("Milanesa");
    expect(emitidos.items[0]!.detalle.lineas.map((l) => l.producto)).toEqual(alCerrar.lineas.map((l) => l.producto));
    // El total no depende de lo que se imprime.
    expect(alCerrar.total).toBe(Math.round((alCerrar.lineas.reduce((suma, l) => suma + l.subtotal, 0)) * 100) / 100);
  });

  it("anular parte de una línea ya enviada no cambia su nombre en el ticket (la anulación repite el nombre congelado)", async () => {
    const flan = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: s.flan.id } });
    expect((await anularItemEnviado(flan.id, 1, "Se cayó", 2)).ok).toBe(true);
    const espejo = await prisma.cuentaItem.findFirstOrThrow({ where: { anulaAItemId: flan.id } });
    expect(espejo.nombreEnTicket).toBe("Flan casero");
    expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
    const ticket = await cafeDelTicket();
    const lineaFlan = ticket.lineas.find((l) => l.producto.toLowerCase().includes("flan"))!;
    expect(lineaFlan).toMatchObject({ producto: "Flan casero", cantidad: 1 });
  });
});
