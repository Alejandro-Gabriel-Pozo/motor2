/**
 * El ADAPTADOR de imports de las huellas de auth (plan de la Fase 4, B0; trabajo O.11 de la rama `pureza-integracion`). Las huellas (`huella-de-gobierno`, `huella-de-login`,
 * `huella-de-alta-de-admin`) fijan el comportamiento de funciones que la Fase 4 MUEVE de archivo (B3: login e invitaciones a `server/sesion/`; B4: gobierno a casos de uso). Para que una
 * mudanza no obligue a tocar el cuerpo de las huellas —que no se editan—, todas importan lo que prueban DESDE ACÁ: cuando una función cambia de lugar, se cambia un solo `export … from`,
 * en el mismo commit que la mueve, y el golden queda intacto.
 */
import { aceptarInvitacionDeGerenteCasoDeUso } from "../../../src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente";
// B3-5 y B3-7: los casos de uso piden `ahora` (no leen el reloj); la huella de gobierno, escrita antes, no lo pasa: la hora del pedido, como la ponía el valor por defecto viejo.
export const aceptarInvitacionDelToken = (e: Omit<Parameters<typeof aceptarInvitacionDeGerenteCasoDeUso>[0], "ahora"> & { ahora?: Date }) => aceptarInvitacionDeGerenteCasoDeUso({ ...e, ahora: e.ahora ?? new Date() });
import { aceptarInvitacionDeUsuarioCasoDeUso } from "../../../src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-usuario";
export const aceptarInvitacionDeUsuarioDelToken = (e: Omit<Parameters<typeof aceptarInvitacionDeUsuarioCasoDeUso>[0], "ahora"> & { ahora?: Date }, guard: Parameters<typeof aceptarInvitacionDeUsuarioCasoDeUso>[1]) => aceptarInvitacionDeUsuarioCasoDeUso({ ...e, ahora: e.ahora ?? new Date() }, guard);
export { vincularCuentaConInvitacion } from "../../../src/server/sesion/vincular-cuenta";
export { requierePermiso } from "../../../src/server/acceso/gate";
export { asegurarInvitacionDeUsuario, revocarInvitacionPendiente, rotarInvitacionPendiente } from "../../../src/server/actions/auth/casos-de-uso/invitaciones-de-usuario-en-tx";
export { cambiarModulosDeEmpresa } from "../../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
export { cambiarPoliticaDeEmpresa } from "../../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
export { sembrarEmpresa } from "../../../plataforma/src/servidor/sembrar-empresa";
export { crearAdminDePlataforma } from "../../../plataforma/src/servidor/alta-de-admin";
export { incorporarPrimerGerente } from "../../../src/core/permisos/gerencia";
export { transferirGerenciaDeEmpresa } from "../../../src/server/actions/auth/casos-de-uso/transferir-gerencia-en-tx";
export { registrarCambioAuditado } from "../../../src/core/permisos/auditoria";
export { hashDeToken } from "../../../src/core/seguridad/tokens";
export { azarDelProceso } from "../../../src/lib/azar";
