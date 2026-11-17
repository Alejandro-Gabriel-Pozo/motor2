import type { Prisma, PrismaClient } from "@prisma/client";
import { ModulosDeEmpresaError, normalizarPedidoDeModulos, planDeCambioDeModulos, type CambioDeModulosHecho, type CambioDeModulosPedido } from "@/core/features/empresa/cambio-de-modulos";
import { ACCION_DE_APAGADO_RECHAZADO, apagadoRechazadoPorComprasPendientes, MODULO_CON_GUARDA_DE_APAGADO, textoDeApagadoRechazado } from "@/core/modulos/guarda-de-apagado";
import { auditarCambioDePlataforma, type AutorDeCambioDePlataforma } from "./auditar-cambio-de-plataforma";

/**
 * Activa y desactiva módulos vendibles de una empresa en el registro `ModuloEmpresa` (ADR-011, ADR-014, ADR-015). SOLO la plataforma lo hace: lo llama el script
 * `scripts/modulos-empresa.ts` y nada del resto de `src/` (regla `operaciones-de-plataforma-solo-desde-scripts` de dependency-cruiser). Además la base lo exige: solo
 * el dueño y `motor2_plataforma` escriben esa tabla (RLS + REVOKE a `motor2_app` + trigger). Sin `import "server-only"`: lo importan scripts con `tsx` y specs de Playwright.
 *
 * El cálculo (validar el pedido, qué filas cambian) es puro y vive en `core/features/empresa/cambio-de-modulos.ts`; acá se LEE el registro y se ESCRIBE. `autor` es el
 * administrador de plataforma ya verificado (`requerirAdminDePlataforma`, contra la base de identidad de la consola) y la instalación en la que opera: NO es un `User` (S-33,
 * decisión del dueño). Cada fila que cambia deja una fila de `AuditoriaPlataforma` a su nombre, con la instalación en el `detalle`; todo en una transacción, así que un cambio
 * revertido no deja su fila. Estos cambios ya no aparecen en el registro de auditoría de la empresa. Como `cambiarPoliticaDeEmpresa`, `db` es un cliente SIN empresa y la
 * transacción fija `app.empresa_id` en la empresa elegida para poder leer su registro con el RLS puesto.
 *
 * Guarda de apagado (docs/diseno-compras-guarda-de-apagado-2026-11-17.md): apagar `recepcion_de_compras` con compras pendientes de recibir (de cualquier sucursal) lo rechaza la BASE con un disparador; acá ese error se traduce a un
 * `ModulosDeEmpresaError` con el texto de siempre (el script lo imprime y sale con error, no con una excepción cruda) y, como la transacción ya se revirtió, el intento rechazado deja su propia fila de auditoría («modulo-desactivar-rechazado»).
 */
export async function cambiarModulosDeEmpresa(db: PrismaClient, pedido: CambioDeModulosPedido, autor: AutorDeCambioDePlataforma): Promise<CambioDeModulosHecho> {
  const { activar, desactivar } = normalizarPedidoDeModulos(pedido);
  let empresaDelPedido: string | null = null;

  try {
    return await aplicarCambioDeModulos(db, pedido, autor, activar, desactivar, (id) => {
      empresaDelPedido = id;
    });
  } catch (error) {
    const rechazo = apagadoRechazadoPorComprasPendientes(error);
    if (!rechazo) throw error;
    // Nada cambió (la sentencia falló y la transacción se revirtió). El rastro del intento va en otra escritura: si ella falla, el rechazo igual se informa y el texto lo dice (la base ya cerró).
    let conRastro = true;
    if (empresaDelPedido !== null) {
      try {
        await auditarCambioDePlataforma(db, autor, ACCION_DE_APAGADO_RECHAZADO, empresaDelPedido, { modulo: MODULO_CON_GUARDA_DE_APAGADO, pendientes: rechazo.cantidad });
      } catch {
        conRastro = false;
      }
    }
    throw new ModulosDeEmpresaError(textoDeApagadoRechazado(rechazo) + (conRastro ? "" : " No se pudo dejar el rastro del intento en la auditoría de plataforma."));
  }
}

function aplicarCambioDeModulos(
  db: PrismaClient,
  pedido: CambioDeModulosPedido,
  autor: AutorDeCambioDePlataforma,
  activar: string[],
  desactivar: string[],
  alConocerLaEmpresa: (empresaId: string) => void,
): Promise<CambioDeModulosHecho> {
  return db.$transaction(async (tx) => {
    // S-33: la fila de la empresa se toma ANTES de leer el registro (`FOR UPDATE`): dos corridas a la vez se serializan y la segunda planifica sobre lo que dejó la primera, en vez de
    // calcular su «antes» sobre el mismo estado y pisarla (con una auditoría que dice un «antes» que ya no era cierto).
    await tx.$queryRaw`SELECT id FROM "Empresa" WHERE slug = ${pedido.slug} FOR UPDATE`;
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true } });
    if (!empresa) throw new ModulosDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);
    alConocerLaEmpresa(empresa.id);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const filas = await tx.moduloEmpresa.findMany({ where: { empresaId: empresa.id } });
    const plan = planDeCambioDeModulos(filas, { activar, desactivar });

    for (const { modulo, antes, despues } of plan.cambiados) {
      await tx.moduloEmpresa.upsert({
        where: { empresaId_modulo: { empresaId: empresa.id, modulo } },
        create: { empresaId: empresa.id, modulo, estado: despues },
        update: { estado: despues },
      });
      await auditarCambioDePlataforma(tx, autor, despues === "ACTIVO" ? "modulo-activado" : "modulo-desactivado", empresa.id, { modulo, antes: antes ?? "sin fila", despues });
    }

    return { empresaId: empresa.id, cambiados: plan.cambiados, activos: plan.activos, efectivos: plan.efectivos };
  });
}

/** Los módulos vendibles que la empresa tiene ACTIVOS en el registro. Es el único lector del registro de la plataforma (lo usa también `planes.ts` para avisar qué módulos quedarían fuera del techo de un plan). */
export async function modulosActivosDelRegistro(tx: Prisma.TransactionClient, empresaId: string): Promise<string[]> {
  const filas = await tx.moduloEmpresa.findMany({ where: { empresaId, estado: "ACTIVO" }, select: { modulo: true } });
  return filas.map((f) => f.modulo);
}
