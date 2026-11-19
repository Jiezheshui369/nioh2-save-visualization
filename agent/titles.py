"""Read only the validated persisted title set; no live completion/visibility claim.

Layout and native hash/list invariants: reconstruct_title_snapshot.py underlying
verified saved-title-snapshot-join/v226. Static definitions are independent of
player snapshots. Notification bytes are checked structurally, never as awards.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

CATALOG = json.loads((Path(__file__).parent/'data/titles-v1.json').read_text(encoding='utf-8'))
NEXT, KEYS, FLAGS = 0x1EF284, 0x1F0284, 0x1F1284
HEAD, TAIL, COUNT = 0x1F1684, 0x1F1688, 0x1F168C
CAPACITY, END, EMPTY = 1024, 1024, 0xFFFFFFFF


def _require(condition: bool) -> None:
    if not condition:
        raise ValueError('unsupported-title-set')


def _members(data: bytes) -> set[int]:
    _require(len(data) == 2715432 and data[:8] == b'NIOHUSR\0')
    _require(tuple(struct.unpack_from('<I', data, p)[0] for p in (8, 0x14, 0x18, 0x150))
             == (0x21030200, 0x148, 0x296de0, 0x21030200) and data[-16:] == bytes(16))
    definitions = {d['titleId'] for d in CATALOG['definitions']}
    head, tail, count = struct.unpack_from('<III', data, HEAD)
    _require(count <= min(CAPACITY, len(definitions)))
    links = struct.unpack_from('<1024I', data, NEXT)
    keys = struct.unpack_from('<1024I', data, KEYS)
    _require(all(n == EMPTY or n <= END for n in links))
    used = {i for i, n in enumerate(links) if n != EMPTY}
    _require(len(used) == count)
    if count == 0:
        _require(head == tail == END)
        return set()
    _require(head < CAPACITY and tail < CAPACITY)
    seen, members, slot, last = set(), set(), head, None
    while slot != END:
        _require(slot < CAPACITY and slot in used and slot not in seen)
        seen.add(slot); key = keys[slot]
        _require(key in definitions and key not in members and data[FLAGS+slot] in (0, 1))
        members.add(key); last = slot; slot = links[slot]
    _require(seen == used and last == tail)
    for slot in seen:
        probe = keys[slot] & (CAPACITY-1)
        for _ in range(CAPACITY):
            _require(probe in used)
            if keys[probe] == keys[slot]:
                break
            probe = (probe+1) & (CAPACITY-1)
        else:
            raise ValueError('exhausted-title-probe')
        _require(probe == slot)
    return members


def derive_titles(data: bytes) -> dict:
    """An unsupported title profile is unknown without blocking other modules."""
    try:
        members = _members(data)
    except (ValueError, struct.error):
        members = None
    groups = []
    for category in (0, 1):
        definitions = [d for d in CATALOG['definitions'] if d['category'] == category]
        awarded = None if members is None else sum(d['titleId'] in members for d in definitions)
        groups.append(dict(category=category, total=len(definitions), awarded=awarded,
            notAwarded=None if awarded is None else len(definitions)-awarded,
            unknown=len(definitions) if awarded is None else 0))
    total = sum(g['total'] for g in groups)
    awarded = None if members is None else len(members)
    return dict(version=1, gameId='nioh2', definitionVersion=CATALOG['version'],
        state='unknown' if members is None else 'verified-saved-set',
        reason='unsupported-layout-or-set' if members is None else None,
        entries=[dict(titleId=d['titleId'], savedAwarded=None if members is None else d['titleId'] in members)
                 for d in CATALOG['definitions']],
        summary=dict(total=total, awarded=awarded, notAwarded=None if awarded is None else total-awarded,
                     unknown=total if awarded is None else 0, groups=groups),
        current=dict(completed=None, progress=None, visible=None, claimable=None))
