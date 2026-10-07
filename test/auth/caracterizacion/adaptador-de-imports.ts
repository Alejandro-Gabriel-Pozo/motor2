/**
 * El ADAPTADOR de imports de las huellas de auth (plan de la Fase 4, B0; trabajo O.11 de la rama `pureza-integracion`). Las huellas (`huella-de-gobierno`, `huella-de-login`,
 * `huella-de-alta-de-admin`) fijan el comportamiento de funciones que la Fase 4 MUEVE de archivo (B3: login e invitaciones a `server/sesion/`; B4: gobierno a casos de uso). Para que una
 * mudanza no obligue a tocar el cuerpo de las huellas —que no se editan—, todas importan lo que prueban DESDE ACÁ: cuando una función cambia de lugar, se cambia un solo `export … from`,
 * en el mismo commit que la mueve, y el golden queda intacto.
 */
export { aceptarInvitacionDelToken, aceptarInvitacionDeUsuarioDelToken, vincularCuentaConInvitacion } from "../../../src/core/auth/invitacion";
export { requierePermiso } from "../../../src/server/acceso/gate";
export { asegurarInvitacionDeUsuario, revocarInvitacionPendiente, rotarInvitacionPendiente } from "../../../src/core/features/empresa/invitacion-de-usuario";
export { cambiarModulosDeEmpresa } from "../../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
export { cambiarPoliticaDeEmpresa } from "../../../src/server/operaciones-de-plataforma/cambiar-politica-de-empresa";
export { sembrarEmpresa } from "../../../plataforma/src/servidor/sembrar-empresa";
export { crearAdminDePlataforma } from "../../../plataforma/src/servidor/alta-de-admin";
export { incorporarPrimerGerente, transferirGerenciaDeEmpresa } from "../../../src/core/permisos/gerencia";
export { registrarCambioAuditado } from "../../../src/core/permisos/auditoria";
export { hashDeToken } from "../../../src/core/seguridad/tokens";
export { azarDelProceso } from "../../../src/lib/azar";
