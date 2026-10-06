import { probarMigracionDeParticion } from "./particion-migracion-harness";

/**
 * Migración de datos 20261007120000_accion_renombrar_rol (bloque G, G3): `gestion_roles` suelta el renombrado de roles en la clave nueva
 * `renombrar_rol`. Quien podía crear y desactivar roles puede renombrarlos; el padre sigue y no cambia de descripción.
 */
probarMigracionDeParticion({
  directorio: "20261007120000_accion_renombrar_rol",
  titulo: "acción renombrar_rol (G3)",
  sentenciasEsperadas: 3,
});
