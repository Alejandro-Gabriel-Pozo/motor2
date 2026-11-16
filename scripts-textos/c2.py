# Lote C2: el resto de los «No se encontró …» sin otro frente al molde con entidad (sobre C1). Correr en la raíz del repo. Uso: python3 c2.py DEC-NNNN
import re,json,os,collections,sys
DEC=sys.argv[1]
ARCHIVOS="""src/core/features/movimientos/cancelar-conteo.guard.ts
src/core/features/movimientos/resolver-conteo.guard.ts
src/core/features/movimientos/secciones.guard.ts
src/core/features/seccion-habitual/seccion-habitual.guard.ts
src/core/features/traspasos/traspaso-comandos.guard.ts
src/server/actions/clientes/casos-de-uso/actualizar-activo-cliente.ts
src/server/actions/clientes/casos-de-uso/actualizar-cliente.ts
src/server/actions/movimientos/casos-de-uso/actualizar-activa-seccion.ts
src/server/actions/movimientos/casos-de-uso/actualizar-activo-destino-consumo.ts
src/server/actions/movimientos/casos-de-uso/actualizar-activo-motivo-merma.ts
src/server/actions/movimientos/casos-de-uso/actualizar-respaldo-seccion.ts
src/server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico.ts
src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico.ts
src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts
src/server/actions/movimientos/casos-de-uso/renombrar-seccion.ts
src/server/actions/movimientos/casos-de-uso/resolver-conteo-pendiente.ts
src/server/actions/reportes/casos-de-uso/guardar-margen-objetivo.ts
src/server/actions/stock/casos-de-uso/eliminar-frecuencia-conteo.ts
src/server/actions/stock/casos-de-uso/eliminar-seccion-habitual.ts
src/server/actions/stock/casos-de-uso/eliminar-stock-minimo.ts
src/server/actions/stock/casos-de-uso/reclasificar-stock.ts
src/server/actions/stock/casos-de-uso/set-frecuencia-conteo.ts
src/server/actions/stock/casos-de-uso/set-seccion-habitual.ts
src/server/actions/stock/casos-de-uso/set-stock-minimo-producto.ts
src/server/persistencia/movimientos/cargar-origen-de-venta.ts""".split()
ENT={"cliente":"cliente","depósito":"deposito","destino":"destino","motivo":"motivo","conteo":"conteo","producto":"producto","sección":"seccion","sección destino":"seccion_destino","sección de origen":"seccion_de_origen","categoría":"categoria","traspaso":"traspaso","depósito habitual":"deposito_habitual","fila de Frecuencia de conteo":"fila_de_frecuencia_de_conteo","fila de Stock Mínimo":"fila_de_stock_minimo"}
GEN={"cliente":"m","deposito":"m","destino":"m","motivo":"m","conteo":"m","producto":"m","seccion":"f","seccion_destino":"f","seccion_de_origen":"f","categoria":"f","traspaso":"m","deposito_habitual":"m","fila_de_frecuencia_de_conteo":"f","fila_de_stock_minimo":"f"}
NOM={v:k for k,v in ENT.items()}
RX=re.compile(r'(["`])No se encontró (?:el|la|ese|esa) ([^"`.$]+)\.\1')
usos=collections.OrderedDict(); usadas=set(); cambios=0
def encierra(ls,i):
    for j in range(i,-1,-1):
        m=re.match(r"(?:export )?(?:async )?function (\w+)|(?:export )?const (\w+)\b",ls[j])
        if m: return m.group(1) or m.group(2)
for p in ARCHIVOS:
    s=open(p).read(); ls=s.split("\n"); n=0; nombres=set()
    for i,l in enumerate(ls):
        if l.lstrip().startswith(("*","//","/*")): continue
        for cod,ent in (("CONTEO_NO_ENCONTRADO","conteo"),("PRODUCTO_NO_ENCONTRADO","producto")):
            ant=f'textoDe("rechazo.{cod}")'
            if ant in l:
                ls[i]=ls[i].replace(ant,f'textoDe("rechazo.NO_ENCONTRADO", {{ entidad: ENTIDADES.{ent} }})'); n+=1; usadas.add(ent); nombres.add(encierra(ls,i)); l=ls[i]
        for m in RX.finditer(l):
            art=re.match(r'.No se encontró (el|la|ese|esa) ',m.group(0)).group(1)
            e=ENT[m.group(2)]
            if GEN[e]!=("m" if art in("el","ese") else "f"): raise SystemExit(f"género distinto {e} {art} {p}:{i+1}")
        def rep(m):
            e=ENT[m.group(2)]; usadas.add(e)
            return f'textoDe("rechazo.NO_ENCONTRADO", {{ entidad: ENTIDADES.{e} }})'
        nl,k=RX.subn(rep,l)
        if k: ls[i]=nl; n+=k; nombres.add(encierra(ls,i))
    assert n>0,p
    s="\n".join(ls)
    if 'from "@/core/textos/texto-de"' not in s:
        L=s.split("\n"); k=max(i for i,l in enumerate(L) if l.startswith("import ") and l.rstrip().endswith(";")); L.insert(k+1,'import { textoDe } from "@/core/textos/texto-de";'); s="\n".join(L)
    if 'from "@/core/textos/entidades"' not in s:
        L=s.split("\n"); k=max(i for i,l in enumerate(L) if 'from "@/core/textos/texto-de"' in l); L.insert(k+1,'import { ENTIDADES } from "@/core/textos/entidades";'); s="\n".join(L)
    open(p,"w").write(s); cambios+=n; usos[p]=sorted(x for x in nombres if x)
cambios_t={"No se encontró ese cliente.":"No se encontró el cliente.","No se encontró ese conteo.":"No se encontró el conteo.","No se encontró ese traspaso.":"No se encontró el traspaso.","No se encontró ese depósito habitual.":"No se encontró el depósito habitual.","No se encontró esa fila de Frecuencia de conteo.":"No se encontró la fila de Frecuencia de conteo.","No se encontró esa fila de Stock Mínimo.":"No se encontró la fila de Stock Mínimo."}
tests="""test/clientes/cliente-mensajes.test.ts
test/catalogo/activar-id-inexistente.test.ts
test/core/features/movimientos/conteo-comandos-guard.test.ts
test/casos-de-uso/traspasos-solicitud.test.ts
test/casos-de-uso/traspasos-recepcion.test.ts
test/stock/seccion-habitual-orden.test.ts
test/stock/seccion-habitual-action.test.ts
test/core/features/seccion-habitual/seccion-habitual-guard.test.ts
test/stock/frecuencia-conteo-mensajes.test.ts
test/stock/stock-minimo-mensajes.test.ts""".split()
tt=0
for t in tests:
    if not os.path.exists(t): continue
    s=open(t).read(); o=s
    for a,b in cambios_t.items(): s=s.replace(a,b)
    s=s.replace("«No se encontró ese conteo.»","«No se encontró el conteo.»")
    if s!=o: open(t,"w").write(s); tt+=1
p="src/core/textos/entidades.ts"; s=open(p).read()
nuevas="".join(f'  {k}: {{ nombre: "{NOM[k]}", genero: "{GEN[k]}" }},\n' for k in sorted(usadas))
s=s.replace("} as const satisfies",nuevas+"} as const satisfies",1); open(p,"w").write(s)
p="test/textos/oraculo-de-entidades.ts"; s=open(p).read()
def frase(k): return f'No se encontró {"la" if GEN[k]=="f" else "el"} {NOM[k]}.'
filas="".join(f'  {k}: {{ genero: "{GEN[k]}", noSeEncontro: "{frase(k)}" }},\n' for k in sorted(usadas))
s=s.rstrip().rstrip("};").rstrip()+"\n"+filas+"};\n"; open(p,"w").write(s)
p="src/core/textos/catalogo.ts"; s=open(p).read()
for cod in ("CONTEO_NO_ENCONTRADO","PRODUCTO_NO_ENCONTRADO"):
    s=re.sub(r'  "rechazo\.'+cod+r'": \{.*?\n  \},\n','',s,count=1,flags=re.S)
extra=",\n".join(f'      {{ archivo: "{a}", nombre: "{n}" }}' for a,ns in usos.items() for n in ns)
i=s.index('"rechazo.NO_ENCONTRADO"'); j=s.index("    ],\n",i)
if not s[:j].rstrip().endswith(","): s=s[:j].rstrip("\n")+",\n"+s[j:]
j=s.index("    ],\n",s.index('"rechazo.NO_ENCONTRADO"'))
s=s[:j]+extra+",\n"+s[j:]
s=s.replace("Hoy lo usa `server/actions/auth/`; el resto de los sitios entra en C2.",f"Lo usan `server/actions/auth/` (C1) y los casos de uso y guards de movimientos, stock, clientes, reportes y traspasos (C2, {DEC}). Absorbe las claves por código del lote A.")
s=re.sub(r"  // Lote A \(DEC-\d+\): «No se encontró …» idénticos con el mismo código, una clave por código.\n","",s)
open(p,"w").write(s)
r="docs/registro-de-decisiones.md"; s=open(r).read().rstrip("\n")
s+=f'''

### {DEC}
- **Fecha:** 2026-11-16
- **Quién:** la sesión Sonnet de los lotes de reducción del catálogo de textos (lote C2); aceptación directa del dueño.
- **Qué decidió:** el resto de los «No se encontró …» de casos de uso y guards sin otro frente (movimientos, stock, clientes, reportes, traspasos y los guards de conteo, sección y traspaso: 32 sitios en 25 archivos) pasan al molde único `rechazo.NO_ENCONTRADO` con el género de la cosa. Entran 14 entidades a `ENTIDADES`: cliente, depósito, destino, motivo, conteo, producto, sección, sección destino, sección de origen, categoría, traspaso, depósito habitual, fila de Frecuencia de conteo y fila de Stock Mínimo. Lo que ve distinto el personal: seis frases pasan de «ese/esa» a «el/la» («No se encontró el cliente / el conteo / el traspaso / el depósito habitual / la fila de Frecuencia de conteo / la fila de Stock Mínimo»); las otras ocho quedan palabra por palabra. Reemplaza las dos claves por código que quedaban del lote A (`rechazo.CONTEO_NO_ENCONTRADO` y `rechazo.PRODUCTO_NO_ENCONTRADO`), que se borran. Quedan literales, por pertenecer a otros frentes o llevar una cola que dice otra cosa: pos, catálogo, carta, compras, partes, permisos, `origen-de-copia`, las frases «en esta sucursal» de los guards de cuentas y las del rol de administrador y el proveedor inactivo.
- **Por qué:** el dueño eligió un solo molde para «no se encontró»; con C1 ya existía la primitiva (`docs/diseno-textos-en-datos-2026-11-16.md`, D-6 y D-10).
- **Costo de revertir:** bajo: volver a escribir las frases literales en los 25 archivos y sacar las 14 entidades; las pruebas que citan las seis frases cambiadas vuelven a su texto; no hay migración ni datos.
- **Dónde:** `src/core/textos/catalogo.ts`, `src/core/textos/entidades.ts`
- **Estado:** ACEPTADA
- **Cita del dueño:** «Sí, un solo molde (Recomendada)» — 2026-11-16 — chat del dueño con el orquestador (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Textos: cuatro respuestas del dueño sobre la lista única»)
'''
open(r,"w").write(s)
print("sitios",cambios,"tests",tt,"entidades",len(usadas))
