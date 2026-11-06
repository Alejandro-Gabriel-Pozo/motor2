"""MAQUETA: recorta de las capturas de página completa (375 px, escala 2) la cabecera de la tabla + las filas de interés, sin tocar nada de lo dibujado. Uso: python3 recortar.py antes|despues"""
import json, sys, os
from PIL import Image
cuando = sys.argv[1]
aqui = os.path.join(os.path.dirname(__file__), "..")
pos = json.load(open(os.path.join(aqui, f"{cuando}-posiciones.json")))
E = 2

def pegar(origen, p, ventanas, salida):
    img = Image.open(os.path.join(aqui, origen))
    ch = p["__cabecera"]
    trozos = [img.crop((0, int((ch[0] - 8) * E), img.width, int(ch[1] * E)))]
    for desde, hasta in ventanas:
        if desde not in p or hasta not in p:
            desde = hasta = next(k for k in (desde, hasta) if k in p) if (desde in p or hasta in p) else None
            if desde is None:
                continue
        y0, y1 = int(min(p[desde][0], p[hasta][0]) * E), int(max(p[desde][1], p[hasta][1]) * E)
        trozos.append(Image.new("RGB", (img.width, 24), (200, 200, 200)))
        trozos.append(img.crop((0, y0 - 8, img.width, y1 + 8)))
    alto = sum(t.height for t in trozos)
    lienzo = Image.new("RGB", (img.width, alto), (255, 255, 255))
    y = 0
    for t in trozos:
        lienzo.paste(t.convert("RGB"), (0, y)); y += t.height
    lienzo.save(os.path.join(aqui, salida)); print(salida, lienzo.size)

for lado, suf in (("", ""), ("-derecha", "-derecha")):
    pegar(f"capacidades-{cuando}{lado}.png", pos["capacidades"], [("activar_usuario_sucursal", "alta_producto"), ("apagar_cuenta_empresa", "apagar_cuenta_empresa"), ("compra_recibir", "compra_recibir"), ("gestion_permisos", "gestion_usuarios")], f"capacidades-{cuando}-recorte{suf}.png")
    pegar(f"matriz-{cuando}{lado}.png", pos["matriz"], [("compra_recibir", "compra_repartir"), ("reporte_compras", "reporte_costos")], f"matriz-{cuando}-recorte{suf}.png")
