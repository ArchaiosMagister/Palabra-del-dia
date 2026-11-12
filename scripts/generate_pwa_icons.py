#!/usr/bin/env python3
"""Rasteriza los iconos SVG para navegador, Android e iOS sin modificar las PWA."""
from pathlib import Path
import json
import struct
import cairosvg

ROOT = Path(__file__).resolve().parents[1]
SITES = [
    ("", "icono-bachillerato-phi.png"),
    ("4eso", "icono-4eso-coliseo.png"),
]
PNG_HEADER = bytes.fromhex("89504e470d0a1a0a")

def main():
    for folder, apple_icon in SITES:
        site = ROOT / folder
        svg = (site / "pwa-icon.svg").read_bytes()
        files = [
            ("pwa-icon-192.png", 192),
            ("pwa-icon-512.png", 512),
            (apple_icon, 180),
        ]
        for filename, size in files:
            output = site / filename
            cairosvg.svg2png(bytestring=svg, write_to=str(output),
                             output_width=size, output_height=size)
            raw = output.read_bytes()
            assert raw.startswith(PNG_HEADER), f"No es PNG: {output}"
            width, height = struct.unpack(">II", raw[16:24])
            assert (width, height) == (size, size), f"Tamaño incorrecto: {output}"
        manifest = json.loads((site / "manifest.webmanifest").read_text(encoding="utf-8"))
        for icon in manifest["icons"]:
            assert (site / icon["src"]).is_file(), f"Falta {icon['src']}"
        print(f"{folder or 'bachillerato'}: SVG + PNG 180/192/512 correctos")

if __name__ == "__main__":
    main()
