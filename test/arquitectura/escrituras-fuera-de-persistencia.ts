/**
 * Las escrituras a la base que HOY siguen fuera de `src/server/persistencia/` (Fase 4 del plan de pureza). La regla es
 * `escrituras-solo-en-persistencia.test.ts`; esta lista solo puede ACHICARSE: cada archivo que se migra a un caso de uso con su
 * persistencia sale de acá en el mismo commit, y `TOPE_DE_ENTRADAS` baja con él.
 *
 * `escrituras` es el multiconjunto `modelo.operación` del archivo (más `$executeRaw*` para el SQL crudo de escritura): si crece, la regla
 * falla («no puede empeorar»); si baja, falla pidiendo fijar la mejora; si llega a cero, pide sacar la entrada. Se usa el multiconjunto y
 * no los números de línea porque las líneas se mueven con cualquier edición.
 */
export type FaseDeEscritura = "Fase 4" | "Fase 6" | "Consola" | "Permanente";

export interface EscrituraHeredada {
  /** `modelo.operación` de cada escritura del archivo, ordenado y con repeticiones. */
  escrituras: readonly string[];
  fase: FaseDeEscritura;
  motivo: string;
}

/** Cuántas entradas tiene la lista. Solo baja: agregar una exige tocar este número y se ve en la revisión. */
export const TOPE_DE_ENTRADAS = 21;

export const ESCRITURAS_FUERA_DE_PERSISTENCIA: Readonly<Record<string, EscrituraHeredada>> = {
  "plataforma/src/servidor/auditoria.ts": {
    escrituras: ["auditoriaPlataforma.create", "auditoriaPlataforma.create"],
    fase: "Consola",
    motivo: "La consola de plataforma es otra app con su propio régimen: escribe sus tablas (y las de las empresas) desde sus propios servidores; entra a la regla en una fase propia (D-6 del plan de la Fase 4).",
  },
  "plataforma/src/servidor/ciclo-de-vida.ts": {
    escrituras: ["$executeRaw", "auditoriaPlataforma.create", "empresa.updateMany", "empresa.updateMany", "empresa.updateMany"],
    fase: "Consola",
    motivo: "La consola de plataforma es otra app con su propio régimen: escribe sus tablas (y las de las empresas) desde sus propios servidores; entra a la regla en una fase propia (D-6 del plan de la Fase 4).",
  },
  "plataforma/src/servidor/empresas.ts": {
    escrituras: ["$executeRaw", "empresa.create", "invitacion.create", "invitacion.create", "invitacion.update", "invitacion.updateMany", "invitacion.updateMany", "invitacion.updateMany"],
    fase: "Consola",
    motivo: "La consola de plataforma es otra app con su propio régimen: escribe sus tablas (y las de las empresas) desde sus propios servidores; entra a la regla en una fase propia (D-6 del plan de la Fase 4).",
  },
  "plataforma/src/servidor/ingreso.ts": {
    escrituras: ["adminPlataforma.update", "adminPlataforma.update", "adminPlataforma.update", "codigoDeIngresoPlataforma.create", "codigoDeIngresoPlataforma.updateMany", "codigoDeIngresoPlataforma.updateMany", "codigoDeIngresoPlataforma.updateMany", "codigoDeRecuperacionPlataforma.updateMany", "sesionPlataforma.create", "sesionPlataforma.update", "sesionPlataforma.update"],
    fase: "Consola",
    motivo: "La consola de plataforma es otra app con su propio régimen: escribe sus tablas (y las de las empresas) desde sus propios servidores; entra a la regla en una fase propia (D-6 del plan de la Fase 4).",
  },
  "plataforma/src/servidor/modulos.ts": {
    escrituras: ["moduloEmpresa.upsert"],
    fase: "Consola",
    motivo: "La consola de plataforma es otra app con su propio régimen: escribe sus tablas (y las de las empresas) desde sus propios servidores; entra a la regla en una fase propia (D-6 del plan de la Fase 4).",
  },
  "plataforma/src/servidor/sesion.ts": {
    escrituras: ["sesionPlataforma.update", "sesionPlataforma.updateMany"],
    fase: "Consola",
    motivo: "La consola de plataforma es otra app con su propio régimen: escribe sus tablas (y las de las empresas) desde sus propios servidores; entra a la regla en una fase propia (D-6 del plan de la Fase 4).",
  },
  "src/core/auth/base.ts": {
    escrituras: ["$executeRaw", "$executeRaw", "$executeRaw", "$executeRaw"],
    fase: "Fase 6",
    motivo: "No escribe datos: es el set_config local a la transacción (infraestructura de la base por empresa); sale UNA vez a server/sesion junto con contexto y rol-de-ejecucion.",
  },
  "src/server/sesion/vincular-cuenta.ts": {
    escrituras: ["account.create", "invitacion.updateMany"],
    fase: "Permanente",
    motivo: "Escritor de infraestructura de LOGIN, no un caso de uso (Hito 3, B3-3): vincula la cuenta de Google (Account) y consume la invitación de vinculación DENTRO del callback signIn de Auth.js (decidirInicioDeSesion), sin Server Action, sin sesión ni contexto de empresa, en una transacción serializable bajo la empresa de la invitación y con su auditoría.",
  },
  "src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts": {
    escrituras: ["$executeRaw", "moduloEmpresa.upsert"],
    fase: "Permanente",
    motivo: "Operación de plataforma que corre por script (nunca desde la app): activa y desactiva módulos con el rol de plataforma; escritor propio de ModuloEmpresa, con su auditoría.",
  },
  "src/server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts": {
    escrituras: ["$executeRaw", "empresa.update"],
    fase: "Permanente",
    motivo: "Operación de plataforma que corre por script (nunca desde la app): cambia las perillas de política de una empresa; escritor propio de esas columnas, con su auditoría.",
  },
  "plataforma/src/servidor/sembrar-empresa.ts": {
    escrituras: ["accion.createMany", "destinoConsumo.createMany", "motivoMerma.createMany", "permisoRol.createMany", "rol.create", "rol.create", "sucursal.create", "unidad.createMany"],
    fase: "Consola",
    motivo: "La siembra de una empresa nueva es de la plataforma (solo la plataforma da de alta una empresa): vive en la consola, que no puede importar src/server; el plan de lo que siembra es puro en core.",
  },
  "src/core/permisos/auditoria.ts": {
    escrituras: ["registroAuditoria.create"],
    fase: "Fase 4",
    motivo: "Tramo B (PR B5): registrarCambioAuditado pasa a src/server/auditoria; lo puro (filaDeAuditoria) queda en core. Va al final: 26 archivos lo importan.",
  },
  "plataforma/src/servidor/alta-de-admin.ts": {
    escrituras: ["adminPlataforma.create", "codigoDeRecuperacionPlataforma.createMany"],
    fase: "Consola",
    motivo: "El alta de un administrador de plataforma es de la plataforma (la corre una persona, una vez, con el rol motor2_plataforma): vive en la consola, que no puede importar src/server; la validación y el material del alta son puros en core/plataforma/primer-admin.ts.",
  },
  "src/server/actions/carta/contenido-producto.ts": {
    escrituras: ["contenidoCartaProducto.upsert", "contenidoCartaProducto.upsert"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/copiar-carta.ts": {
    escrituras: ["contenidoCartaProducto.createMany", "generoCarta.create", "itemAgrupadoCarta.create", "opcionItemAgrupadoCarta.createMany"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/generos.ts": {
    escrituras: ["generoCarta.create", "generoCarta.update", "generoCarta.update"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/items-agrupados.ts": {
    escrituras: ["itemAgrupadoCarta.create", "itemAgrupadoCarta.update", "itemAgrupadoCarta.update", "opcionItemAgrupadoCarta.create", "opcionItemAgrupadoCarta.deleteMany", "opcionItemAgrupadoCarta.update"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/portal-empresa.ts": {
    escrituras: ["portalCartaEmpresa.upsert"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/registro-publico.ts": {
    escrituras: ["sucursalPublica.create", "sucursalPublica.deleteMany", "sucursalPublica.update", "sucursalPublica.update"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/secciones.ts": {
    escrituras: ["seccionCarta.create", "seccionCarta.update", "seccionCarta.update"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
  "src/server/actions/carta/tema.ts": {
    escrituras: ["temaCartaSucursal.update", "temaCartaSucursal.update", "temaCartaSucursal.upsert"],
    fase: "Fase 4",
    motivo: "Configuración de la carta: se migra a caso de uso + persistencia después de los tramos A, B y C (ver el plan de la Fase 4).",
  },
};
