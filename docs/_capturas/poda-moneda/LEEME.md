# Maqueta: «Perfil de la empresa» antes y después de la poda de moneda (PR #199)

Rama temporal `alegp/tmp-capturas-poda-moneda` (no se mergea). Son capturas de la **pantalla real** (Administración → Empresa, servidor de producción `next start`) a **375 px, escala 2**, sobre una **base local descartable**, con el usuario como gerente de la empresa.

| Archivo | Qué muestra |
|---|---|
| `01-perfil-empresa-ANTES-celular.png` | `main`: la fila «Moneda» muestra lo que hay en la base (`ARS`), como si fuera un dato configurable |
| `02-perfil-empresa-DESPUES-celular.png` | Rama de #199: la fila «Moneda» dice «ARS (peso argentino) · fija para todo el sistema» |

Lo único que cambia entre las dos es el texto de esa fila.

## Qué NO es real (declarado)
- Base local descartable con datos de maqueta: empresa llamada «Empresa», sucursal «Varvarco» (supuesto: no se sabe en cuál opera el cliente real), usuario `gerente@maqueta.local`. El CUIT figura «Todavía no cargado» porque no se cargó ninguno.
- **No se capturó el alta de empresa de la consola de plataforma** (donde desaparece el campo «Moneda (3 letras)»): la consola exige login con TOTP y no se armó para esta maqueta.
