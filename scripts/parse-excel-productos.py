"""
Parsea el Excel RelatorioProduto_*.xls de ferreteria (Jasper) a JSON listo
para insertar. NO toca DB. Output: scripts/_tmp/productos-parsed.json

Reglas:
- Salta header decorativo (primeras filas del reporte Jasper).
- Cada fila valida coincide con regex: "ORDEN - SKU NOMBRE"
- Si despues del SKU no hay nada, nombre = SKU.
- Stock "Sin Exist." o no numerico -> 0. Negativos -> 0.
- Precios formato europeo "1.238" -> 1238.
- SKUs duplicados: sufijo numerico minimo al final (ADHESIVO, ADHESIVO1, ADHESIVO2...)
  con verificacion contra el set global para evitar colisiones.
- Unidad: UNIDAD / KILOGRA(MO) / METROS. Default UNIDAD.
"""
import json, re, os, sys
import pandas as pd

XLSX = r"C:/Users/alan_/Downloads/RelatorioProduto_2026-06-16_12-59-12.xls"
OUT_DIR = os.path.join(os.path.dirname(__file__), "_tmp")
OUT_FILE = os.path.join(OUT_DIR, "productos-parsed.json")

UNIDAD_MAP = {
    "UNIDAD": "UNIDAD",
    "KILOGRA": "KG",
    "METROS": "M",
}

def parse_num(v):
    """Parsea numeros formato europeo '1.238' -> 1238. Tolera int/float/str/NaN."""
    if pd.isna(v): return 0
    if isinstance(v, (int, float)):
        try: return int(v)
        except: return 0
    s = str(v).strip()
    if not s: return 0
    # "Sin Exist." y similares
    if not re.match(r'^[\d.,\-]+$', s):
        return 0
    # Formato europeo: punto como miles, sin decimal en estos datos
    s = s.replace('.', '').replace(',', '.')
    try:
        n = float(s)
        return int(round(n))
    except:
        return 0

def main():
    df = pd.read_excel(XLSX, header=None)
    rows = []
    for i in range(len(df)):
        val = df.iloc[i, 1]
        if not (pd.notna(val) and isinstance(val, str)): continue
        m = re.match(r'^(\d+)\s*-\s*(.+)$', val)
        if not m: continue
        rest = m.group(2).strip()
        # Primer token = SKU, resto = nombre. Si no hay resto, nombre = SKU.
        parts = rest.split(None, 1)
        sku_raw = parts[0]
        nombre_raw = parts[1].strip() if len(parts) > 1 else sku_raw
        # Si nombre vacio o igual al SKU repetido, usar SKU
        if not nombre_raw:
            nombre_raw = sku_raw

        existencia = max(0, parse_num(df.iloc[i, 4]))
        costo = max(0, parse_num(df.iloc[i, 5]))
        precio_venta = max(0, parse_num(df.iloc[i, 7]))
        unidad_raw = df.iloc[i, 13] if pd.notna(df.iloc[i, 13]) else "UNIDAD"
        unidad = UNIDAD_MAP.get(str(unidad_raw).strip().upper(), "UNIDAD")

        rows.append({
            "sku_raw": sku_raw,
            "nombre": nombre_raw[:200],  # cap por seguridad
            "stock_actual": existencia,
            "costo_promedio": costo,
            "precio_venta": precio_venta,
            "unidad_medida": unidad,
        })

    # Manejo de duplicados de SKU con sufijo numerico minimo
    seen = set()
    dup_count = 0
    for r in rows:
        base = r["sku_raw"]
        if base not in seen:
            r["sku"] = base
            seen.add(base)
            continue
        # Probar sufijos 1, 2, 3, ..., 11, 12...
        suf = 1
        while True:
            candidate = f"{base}{suf}"
            if candidate not in seen:
                r["sku"] = candidate
                seen.add(candidate)
                dup_count += 1
                break
            suf += 1

    # Limpiar sku_raw del payload final
    for r in rows: del r["sku_raw"]

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)

    # Stats
    print(f"Productos parseados: {len(rows)}")
    print(f"Duplicados renombrados con sufijo: {dup_count}")
    print(f"Output: {OUT_FILE}")
    print(f"Tamano: {os.path.getsize(OUT_FILE)/1024:.1f} KB")

if __name__ == "__main__":
    main()
