#!/usr/bin/env python3
"""Proves the visibility tests catch each way a hidden post could leak."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
Q = ROOT / "apps/web/lib/server/queries.ts"
MUTANTS = [
    ("lists ignore post hidden", "and coalesce(cs.hidden, false) = false\n  and coalesce(acs.hidden, false) = false", "and coalesce(acs.hidden, false) = false"),
    ("lists ignore author hidden", "and coalesce(cs.hidden, false) = false\n  and coalesce(acs.hidden, false) = false", "and coalesce(cs.hidden, false) = false"),
    ("lists ignore post withheld", "and not (${country} = any(coalesce(cs.withheld_countries, '{}'::text[])))\n  and not (${country} = any(coalesce(acs.withheld_countries, '{}'::text[])))`;", "and not (${country} = any(coalesce(acs.withheld_countries, '{}'::text[])))`;"),
    ("lists ignore author withheld", "and not (${country} = any(coalesce(cs.withheld_countries, '{}'::text[])))\n  and not (${country} = any(coalesce(acs.withheld_countries, '{}'::text[])))`;", "and not (${country} = any(coalesce(cs.withheld_countries, '{}'::text[])))`;"),
    ("lists show deleted posts", "not p.deleted\n  and coalesce(cs.hidden", "true\n  and coalesce(cs.hidden"),
    ("tombstone keeps text", "return { ...base, author: null, text: null, quoteOf: null,", "return { ...base, author: null, text: r.text, quoteOf: null,"),
    ("tombstone keeps author", "return { ...base, author: null, text: null, quoteOf: null,", "return { ...base, author: { address: r.a_address, handle: r.a_handle, name: r.a_name, avatarSeed: r.a_seed, accent: r.a_accent }, text: null, quoteOf: null,"),
    ("hidden post not tombstoned", "if (r.cs_hidden) return { kind: 'removed', reason: r.cs_reason, note: r.cs_note };\n  if (r.acs_hidden)", "if (r.acs_hidden)"),
    ("withheld post not tombstoned", "if (r.cs_withheld?.includes(country)) return { kind: 'withheld', reason: r.cs_reason, note: r.cs_note, countries: r.cs_withheld };", ""),
    ("notifications ignore hidden post", "and coalesce(pcs.hidden, false) = false\n", "\n"),
    ("notifications ignore hidden actor", "where coalesce(acs.hidden, false) = false\n", "where true\n"),
    ("notifications ignore withheld post", "and not (${country} = any(coalesce(pcs.withheld_countries, '{}'::text[])))\n", "\n"),
    ("notifications ignore hidden post author", "and coalesce(ias.hidden, false) = false\n", "\n"),
    ("hidden pin shown", "const pinned = pinnedView && !pinnedView.tombstone && pinnedView.author?.address === r.address ? pinnedView : null;", "const pinned = pinnedView;"),
    ("hidden profile keeps fields", "if (tombstone) {\n    const blank", "if (false) {\n    const blank"),
    ("search ignores hidden profiles", "where p.handle is not null and ${profileVisible(c)}\n      and (starts_with", "where p.handle is not null\n      and (starts_with"),
    ("recent handles ignore hidden", "where ${profileVisible(c)}\n    order by h.claimed_at", "where true\n    order by h.claimed_at"),
    ("who to follow ignores hidden", "where p.handle is not null and p.address <> ${v} and ${profileVisible(c)}", "where p.handle is not null and p.address <> ${v}"),
    ("mutes ignored", "and not exists (select 1 from mutes m where m.profile = ${v} and m.target = p.author)", ""),
    ("blocks ignored", "and not exists (select 1 from blocks b where b.profile = ${v} and b.target = p.author)", ""),
    ("muted words ignored", "and not exists (select 1 from muted_words w where w.profile = ${v} and position(lower(w.word) in lower(p.text)) > 0)", ""),
    ("label hide ignored", "= 'hide'\n    )`;", "= 'never'\n    )`;"),
    ("for you hides formula", "then 1.5 else 1 end", "then 1 else 1 end"),
    ("for you no author discount", "base_score * power(0.7, row_number() over (partition by author order by base_score desc, sig) - 1) as score", "base_score as score"),
    ("wallet lookup leaks hidden profile", "return restricted ? { ...view, name: '', bio: '', website: '', location: '', avatarSeed: 0, accent: 0, restricted } : { ...view, restricted };", "return { ...view, restricted };"),
    ("mute list leaks hidden names", "name: restricted ? '' : r.name,", "name: r.name,"),
]
only = sys.argv[1:]
MUTANTS = [m for m in MUTANTS if not only or m[0] in only]
src = Q.read_text()
survived = []
try:
    for label, old, new in MUTANTS:
        if old not in src:
            print("PATTERN MISSING:", label); survived.append(label); continue
        Q.write_text(src.replace(old, new, 1))
        out = subprocess.run("pnpm vitest run apps/web 2>&1", shell=True, cwd=ROOT, capture_output=True, text=True, timeout=200).stdout
        failed = [l for l in out.splitlines() if " FAIL " in l]
        if failed:
            print(f"caught: {label} ({len(failed)})", flush=True)
        else:
            print(f"SURVIVED: {label}", flush=True); survived.append(label)
finally:
    Q.write_text(src)
print("RESULT:", "all caught" if not survived else f"survivors: {survived}")
sys.exit(1 if survived else 0)
