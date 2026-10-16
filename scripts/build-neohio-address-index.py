#!/usr/bin/env python3
"""Build a local Northeast Ohio street-range index.

Customer keystrokes are matched against this file on our server. The build
reads public-domain US Census TIGER/Line edges, ZCTA-to-place names, and the
ZCTA gazetteer. It does not call Google and it does not upload addresses.

Inputs (already downloaded):
  TIGER edges zips in /tmp/tiger/{39035,39085,...}.zip or cuy.zip
  /tmp/tiger/zcta_place.txt
  /tmp/tiger/gaz/2025_Gaz_zcta_national.txt

Output: data/neohio-address-ranges.json.gz
"""

from __future__ import annotations

import gzip
import json
import struct
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "neohio-address-ranges.json.gz"
TIGER = Path("/tmp/tiger")

# Cuyahoga, Lake, Lorain, Medina, Summit, Geauga, Portage, Ashtabula.
COUNTIES = [
    "39035",
    "39085",
    "39093",
    "39103",
    "39153",
    "39055",
    "39133",
    "39007",
]

PLACE_SUFFIXES = (
    " city",
    " village",
    " CDP",
    " borough",
    " town",
    " municipality",
    " urban county",
)


def iter_dbf(path: Path):
    data = path.read_bytes()
    nrec = struct.unpack("<I", data[4:8])[0]
    hlen = struct.unpack("<H", data[8:10])[0]
    rlen = struct.unpack("<H", data[10:12])[0]
    fields = []
    pos = 32
    while pos < hlen and data[pos] != 0x0D:
        name = data[pos : pos + 11].split(b"\x00", 1)[0].decode()
        flen = data[pos + 16]
        fields.append((name, flen))
        pos += 32
    off = hlen
    for _ in range(nrec):
        rec = data[off : off + rlen]
        off += rlen
        if not rec or rec[:1] == b"*":
            continue
        p = 1
        row = {}
        for name, flen in fields:
            row[name] = rec[p : p + flen].decode("latin1", "replace").strip()
            p += flen
        yield row


def house_number(raw: str) -> int | None:
    digits = []
    for ch in raw:
        if ch.isdigit():
            digits.append(ch)
        else:
            break
    if not digits:
        return None
    n = int("".join(digits))
    if n <= 0 or n > 999999:
        return None
    return n


def load_places() -> dict[str, str]:
    """ZIP -> place name, preferring the named place with the largest overlap."""
    best: dict[str, tuple[str, int]] = {}
    text = (TIGER / "zcta_place.txt").read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    for line in lines[1:]:
        parts = line.split("|")
        if len(parts) < 17:
            continue
        z = parts[1].strip()
        if len(z) != 5 or not z.isdigit():
            continue
        name = parts[10].strip()
        for suffix in PLACE_SUFFIXES:
            if name.endswith(suffix):
                name = name[: -len(suffix)]
                break
        try:
            area = int(parts[16] or 0)
        except ValueError:
            area = 0
        prev = best.get(z)
        # A named place beats a larger unnamed overlap.
        if name:
            if not prev or not prev[0] or area > prev[1]:
                best[z] = (name, area)
        elif not prev:
            best[z] = ("", area)
    return {z: name for z, (name, _) in best.items() if name}


def load_points() -> dict[str, tuple[float, float]]:
    gaz = next((TIGER / "gaz").glob("*.txt"))
    points: dict[str, tuple[float, float]] = {}
    for line in gaz.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        parts = line.split("|")
        if len(parts) < 8:
            continue
        z = parts[0].strip()
        try:
            points[z] = (float(parts[6]), float(parts[7]))
        except ValueError:
            continue
    return points


def ranges_from_zip(path: Path):
    with zipfile.ZipFile(path) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".dbf"))
        dest = TIGER / "extract" / Path(name).name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zf.read(name))
    for row in iter_dbf(dest):
        full = row.get("FULLNAME") or ""
        if not full or full.lower().endswith(" rr"):
            continue
        sides = (
            (row.get("LFROMADD", ""), row.get("LTOADD", ""), row.get("ZIPL", "")),
            (row.get("RFROMADD", ""), row.get("RTOADD", ""), row.get("ZIPR", "")),
        )
        for a, b, z in sides:
            if len(z) != 5 or not z.isdigit():
                continue
            start = house_number(a)
            end = house_number(b)
            if start is None or end is None:
                continue
            if start > end:
                start, end = end, start
            yield full, start, end, z


def merge_ranges(rows: list[tuple[str, int, int, str]]) -> list[tuple[str, int, int, str]]:
    grouped: dict[tuple[str, str, int], list[tuple[int, int]]] = defaultdict(list)
    for name, start, end, z in rows:
        parity = 0
        if start % 2 == end % 2:
            parity = 2 if start % 2 == 0 else 1
        grouped[(name, z, parity)].append((start, end))
    merged: list[tuple[str, int, int, str]] = []
    for (name, z, parity), spans in grouped.items():
        spans.sort()
        cur_s, cur_e = spans[0]
        for s, e in spans[1:]:
            # Abutting odd/even ranges are 2 apart (100-198 then 200-298).
            gap = 2 if parity else 1
            if s <= cur_e + gap:
                cur_e = max(cur_e, e)
            else:
                merged.append((name, cur_s, cur_e, z))
                cur_s, cur_e = s, e
        merged.append((name, cur_s, cur_e, z))
    merged.sort()
    return merged


def main() -> None:
    places = load_places()
    points = load_points()
    raw: list[tuple[str, int, int, str]] = []
    zips = [TIGER / "cuy.zip"] + [TIGER / f"{fips}.zip" for fips in COUNTIES if fips != "39035"]
    for path in zips:
        if not path.exists():
            raise SystemExit(f"missing {path}")
        before = len(raw)
        raw.extend(ranges_from_zip(path))
        print(f"{path.name}: {len(raw) - before} sides")
    merged = merge_ranges(raw)
    used_zips = sorted({z for _, _, _, z in merged})
    zmap = {}
    missing_city = 0
    for z in used_zips:
        city = places.get(z, "")
        latlng = points.get(z)
        if not city:
            missing_city += 1
            continue
        if not latlng:
            continue
        zmap[z] = [city, round(latlng[0], 5), round(latlng[1], 5)]
    kept = [row for row in merged if row[3] in zmap]
    payload = {
        "v": 1,
        "source": "US Census TIGER/Line 2025 edges, 2020 ZCTA-place, 2025 ZCTA gazetteer",
        "z": zmap,
        "r": kept,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(payload, separators=(",", ":")).encode()
    with gzip.open(OUT, "wb", compresslevel=9) as fh:
        fh.write(blob)
    print(
        f"ranges {len(kept)} zips {len(zmap)} missing-city-dropped {missing_city} "
        f"json {len(blob)} gz {OUT.stat().st_size}"
    )


if __name__ == "__main__":
    main()
