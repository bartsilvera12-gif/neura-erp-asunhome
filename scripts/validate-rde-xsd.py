"""
Valida un XML rDE contra el XSD oficial v150 (copia offline en .tmp-sifen-xsd).
Uso:
  npx tsx scripts/dump-sample-rde-xml.ts > .tmp-sifen-xsd/in.xml
  python scripts/validate-rde-xsd.py .tmp-sifen-xsd/in.xml
(o stdin). En Windows, generar el XML con buffer UTF-8, p. ej.:
  node -e "require('fs').writeFileSync('.tmp-sifen-xsd/in.xml', require('child_process').execSync('npx tsx scripts/dump-sample-rde-xml.ts'));"
"""
from __future__ import annotations

import sys
from pathlib import Path

from lxml import etree

NS_SIFEN = "http://ekuatia.set.gov.py/sifen/xsd"
NS_DS = "http://www.w3.org/2000/09/xmldsig#"

REPO = Path(__file__).resolve().parents[1]
XSD_DIR = REPO / ".tmp-sifen-xsd"
DE_OFFLINE = XSD_DIR / "DE_v150_offline.xsd"
SCHEMA_MAIN = XSD_DIR / "_siRecepDE_offline_gen.xsd"


def wrap_with_signature_and_qr(xml_bytes: bytes) -> bytes:
    doc = etree.fromstring(xml_bytes)
    if doc.tag != f"{{{NS_SIFEN}}}rDE":
        raise SystemExit("Se esperaba raíz rDE en namespace SIFEN")

    etree.register_namespace("ds", NS_DS)

    de = doc.find(f"{{{NS_SIFEN}}}DE")
    if de is None:
        raise SystemExit("Falta elemento DE")

    cdc = de.get("Id")
    if not cdc or len(cdc) != 44:
        raise SystemExit("DE/@Id debe ser CDC de 44 dígitos")

    qr = f"https://ekuatia.set.gov.py/consultas/qr?nVersion=150&id={cdc}"
    if len(qr) < 100:
        qr = qr + "x" * (100 - len(qr))

    # Firma mínima válida frente a xmldsig-core-schema (contenido criptográfico ficticio)
    sig = etree.Element(etree.QName(NS_DS, "Signature"))
    si = etree.SubElement(sig, etree.QName(NS_DS, "SignedInfo"))
    cm = etree.SubElement(si, etree.QName(NS_DS, "CanonicalizationMethod"))
    cm.set("Algorithm", "http://www.w3.org/2001/10/xml-exc-c14n#")
    sm = etree.SubElement(si, etree.QName(NS_DS, "SignatureMethod"))
    sm.set("Algorithm", "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256")
    ref = etree.SubElement(si, etree.QName(NS_DS, "Reference"))
    ref.set("URI", "")
    dm = etree.SubElement(ref, etree.QName(NS_DS, "DigestMethod"))
    dm.set("Algorithm", "http://www.w3.org/2001/04/xmlenc#sha256")
    dv = etree.SubElement(ref, etree.QName(NS_DS, "DigestValue"))
    dv.text = "YQ=="
    sv = etree.SubElement(sig, etree.QName(NS_DS, "SignatureValue"))
    sv.text = "YQ=="

    g = etree.Element(etree.QName(NS_SIFEN, "gCamFuFD"))
    dqr = etree.SubElement(g, etree.QName(NS_SIFEN, "dCarQR"))
    dqr.text = qr

    # Orden XSD rDE: dVerFor, DE, Signature, gCamFuFD
    doc.append(sig)
    doc.append(g)

    return etree.tostring(
        doc,
        xml_declaration=True,
        encoding="UTF-8",
        pretty_print=True,
    )


def ensure_offline_de_schema() -> None:
    """Genera DE_v150_offline.xsd (includes relativos) desde DE_v150.xsd y raíz siRecep."""
    src = XSD_DIR / "DE_v150.xsd"
    if not src.is_file():
        raise SystemExit(f"Falta {src}; descargar DE_v150.xsd del SET a .tmp-sifen-xsd/")
    text = src.read_text(encoding="utf-8")
    text = text.replace("https://ekuatia.set.gov.py/sifen/xsd/", "")
    DE_OFFLINE.write_text(text, encoding="utf-8")
    SCHEMA_MAIN.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
	elementFormDefault="qualified"
	xmlns="http://ekuatia.set.gov.py/sifen/xsd"
	targetNamespace="http://ekuatia.set.gov.py/sifen/xsd">
	<xs:include schemaLocation="DE_v150_offline.xsd"/>
	<xs:element name="rDE" type="rDE"/>
</xs:schema>
""",
        encoding="utf-8",
    )


def main() -> None:
    if len(sys.argv) > 1:
        raw = Path(sys.argv[1]).read_bytes()
    else:
        raw = sys.stdin.buffer.read()
    if not raw.strip():
        raise SystemExit("Sin XML (stdin o ruta como argumento)")

    ensure_offline_de_schema()

    wrapped = wrap_with_signature_and_qr(raw)
    (XSD_DIR / "sample-rde-wrapped.xml").write_bytes(wrapped)

    if not SCHEMA_MAIN.is_file():
        raise SystemExit(f"Falta {SCHEMA_MAIN}")

    parser = etree.XMLParser(huge_tree=True)
    schema_root = etree.parse(str(SCHEMA_MAIN), parser)
    schema = etree.XMLSchema(schema_root)

    doc = etree.fromstring(wrapped)
    ok = schema.validate(doc)
    if ok:
        print("OK: documento válido frente a siRecepDE_v150.xsd")
        return

    print("INVALIDO frente a XSD:")
    for err in schema.error_log:
        print(f"  línea {err.line}: {err.message}")


if __name__ == "__main__":
    main()
