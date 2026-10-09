import type { PrismaClient } from "@prisma/client";
import { descifrarSecreto } from "../../src/core/plataforma/cifrado";
import { bloqueoVigente, despuesDeUnAcierto, despuesDeUnFallo } from "../../src/core/plataforma/limites";
import { verificarTotp } from "../../src/core/plataforma/totp";
import { ActorDePlataformaError } from "../../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";

/**
 * La PRUEBA del actor de un script de plataforma (M-32 de la auditoría intermedia; el dueño dijo «ok cerrarlo»). `--actor` solo decía QUIÉN firmaba: bastaba tener la URL de conexión de
 * plataforma para firmar como cualquier administrador activo. Ahora el script exige además un código TOTP VIGENTE de ese administrador, el mismo segundo factor con el que entra a la consola
 * (`plataforma/src/servidor/ingreso.ts`, `verificarSegundoFactor`), verificado contra su secreto cifrado en la base y descifrado con `PLATAFORMA_CLAVE_TOTP`.
 *
 * Vive en `scripts/plataforma/` y no en `src/`: la regla `core-plataforma-solo-desde-la-consola` (ADR-019) impide que `src/` importe el login de la consola (`core/plataforma/`), y los scripts de
 * plataforma —como `crear-primer-admin.ts`— sí pueden. Se reusan las piezas puras de ese login en vez de copiarlas, para que un cambio en el segundo factor de la consola alcance también al script.
 *
 * Reglas, las mismas del segundo factor de la consola:
 *  - todo corre bajo el cerrojo de la fila del administrador (`SELECT … FOR UPDATE`): dos intentos en paralelo se hacen la cola, así el contador de fallos y el anti-replay no tienen carrera;
 *  - anti-replay: un código ya usado (en la consola o en otro script) no sirve de nuevo (`ultimoPasoTotp`);
 *  - cupo de intentos COMPARTIDO con la consola: 5 fallos seguidos bloquean 15 minutos al administrador en los dos lados (`despuesDeUnFallo`). Es a propósito: un solo contador no se puede
 *    esquivar probando por el otro camino. Efecto a conocer: quien falla el código de un script bloquea también el ingreso de ese administrador a la consola por 15 minutos;
 *  - cada intento FALLIDO (código equivocado, vencido, ajeno o administrador bloqueado) deja una fila en `AuditoriaPlataforma` (`script-actor-rechazado`), sin el código ni el secreto;
 *  - una sola respuesta para todo fallo: no dice si el código estaba mal, vencido o es de otro, ni si la cuenta está bloqueada.
 *
 * Límite que hay que decir: quien tenga A LA VEZ la URL de conexión de plataforma y `PLATAFORMA_CLAVE_TOTP` puede descifrar el secreto y calcular el código. Esto cierra el robo de la URL sola
 * (la que más se copia a un script o a un chat), no el de las dos variables juntas. El código llega por la variable `PLATAFORMA_CODIGO_ACTOR` o por el prompt de la terminal, nunca por un argumento.
 */
export const MENSAJE_DE_PRUEBA_RECHAZADA =
  "No se pudo comprobar que sos ese administrador de plataforma: el código no es válido (equivocado, vencido o ya usado) o la cuenta está bloqueada por intentos fallidos. El intento quedó en la auditoría de plataforma.";

export const MENSAJE_SIN_CODIGO_DE_ACTOR =
  "Falta el código de tu app de autenticación: --actor solo dice quién firma, y para firmar hace falta probarlo. Pasalo en la variable de entorno PLATAFORMA_CODIGO_ACTOR (solo para este comando; nunca como argumento) o ejecutá el script en una terminal y escribilo cuando lo pida.";

export interface PruebaDelActor {
  /** El código TOTP de 6 dígitos tal como lo escribió la persona; `undefined` si no se dio. */
  codigo: string | undefined;
  /** `PLATAFORMA_CLAVE_TOTP`: la que descifra el secreto guardado. */
  claveTotp: string | undefined;
  ahora: Date;
  /** La instalación desde la que corre el script (para la fila de auditoría de un intento fallido). */
  instalacionId: string;
}

function claveValida(claveBase64: string | undefined): claveBase64 is string {
  return typeof claveBase64 === "string" && Buffer.from(claveBase64, "base64").length === 32;
}

type Motivo = "codigo-incorrecto" | "bloqueado" | "inactivo";
type Veredicto = { ok: true } | { ok: false; motivo: Motivo };

export async function probarActorDePlataforma(db: PrismaClient, actor: { id: string; email: string }, prueba: PruebaDelActor): Promise<void> {
  const codigo = prueba.codigo?.replace(/\s/g, "") ?? "";
  if (!codigo) throw new ActorDePlataformaError(MENSAJE_SIN_CODIGO_DE_ACTOR);
  // Una clave de entorno ausente o mal formada es un error de configuración, no un intento: no cuenta como fallo del administrador (su cuenta no se bloquea por esto).
  if (!claveValida(prueba.claveTotp)) throw new ActorDePlataformaError("Falta PLATAFORMA_CLAVE_TOTP (32 bytes en base64) en el archivo de entorno de plataforma: sin ella no se puede comprobar el código del actor.");
  const claveTotp = prueba.claveTotp;

  const veredicto = await db.$transaction(async (tx): Promise<Veredicto> => {
    await tx.$queryRaw`SELECT id FROM "AdminPlataforma" WHERE id = ${actor.id} FOR UPDATE`;
    const admin = await tx.adminPlataforma.findUnique({
      where: { id: actor.id },
      select: { id: true, email: true, activo: true, bloqueadoHasta: true, secretoTotp: true, ultimoPasoTotp: true, fallosSegundoFactor: true },
    });
    const rechazar = async (motivo: Motivo): Promise<Veredicto> => {
      await tx.auditoriaPlataforma.create({
        data: { adminId: actor.id, adminEmail: actor.email, accion: "script-actor-rechazado", detalle: { origen: "script", motivo, instalacion: prueba.instalacionId } },
      });
      return { ok: false, motivo };
    };
    if (!admin || !admin.activo) return rechazar("inactivo");
    if (bloqueoVigente(admin.bloqueadoHasta, prueba.ahora)) return rechazar("bloqueado");

    const secreto = descifrarSecreto(admin.secretoTotp, claveTotp, admin.id);
    const totp = secreto === null ? ({ ok: false } as const) : verificarTotp(secreto, codigo, prueba.ahora.getTime(), admin.ultimoPasoTotp);
    if (!totp.ok) {
      const despues = despuesDeUnFallo({ fallos: admin.fallosSegundoFactor, bloqueadoHasta: admin.bloqueadoHasta }, prueba.ahora);
      await tx.adminPlataforma.update({ where: { id: admin.id }, data: { fallosSegundoFactor: despues.fallos, bloqueadoHasta: despues.bloqueadoHasta } });
      return rechazar("codigo-incorrecto");
    }

    const limpio = despuesDeUnAcierto();
    await tx.adminPlataforma.update({ where: { id: admin.id }, data: { ultimoPasoTotp: totp.paso, fallosSegundoFactor: limpio.fallos, bloqueadoHasta: limpio.bloqueadoHasta } });
    return { ok: true };
  });

  if (!veredicto.ok) throw new ActorDePlataformaError(MENSAJE_DE_PRUEBA_RECHAZADA);
}
