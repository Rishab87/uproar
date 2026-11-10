#!/usr/bin/env python3
"""Proves the indexer's determinism tests catch each broken reducer rule."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPLY = ROOT / "packages/indexer-core/src/apply.ts"
PARSE = ROOT / "packages/indexer-core/src/parse.ts"
MUTANTS = [
    ("likes ignore chain order", APPLY, "where (${name}.slot, ${name}.sig, ${name}.ix) < (excluded.slot, excluded.sig, excluded.ix)`;", "`;"),
    ("follows ignore chain order", APPLY, "where (follows.slot, follows.sig, follows.ix) < (excluded.slot, excluded.sig, excluded.ix)`;", "`;"),
    ("holder is simply the last mover", APPLY, "if (to && (net.get(to) ?? 0) > 0) return to;", "if (to) return to;"),
    ("no writer lock", APPLY, "await t`select pg_advisory_xact_lock(${WRITER_LOCK})`;\n    let inserted = 0;", "let inserted = 0;"),
    ("post ignores earlier likes", APPLY, "await recountPost(t, m.sig);\n", ""),
    ("anyone can delete", APPLY, "where sig = ${post} and author = ${profile} and not deleted", "where sig = ${post} and not deleted"),
    ("early delete forgotten", APPLY, "exists (select 1 from post_deletes d where d.post = ${m.sig} and d.profile = ${e.profile}))", "false)"),
    ("set_profile ignores chain order", APPLY, "and (meta_slot is null or (meta_slot, meta_sig, meta_ix) < (${m.slot}::bigint, ${m.sig}::text collate \"C\", ${m.ix}::int))`;", "`;"),
    ("pin ignores chain order", APPLY, "and (pin_slot is null or (pin_slot, pin_sig, pin_ix) < (${m.slot}::bigint, ${m.sig}::text collate \"C\", ${m.ix}::int))`;", "`;"),
    ("replay not idempotent", APPLY, "if (rows.length === 0) continue;", ""),
    ("second post in a tx counts", APPLY, "if (inserted.length === 0) return; // Not the first post in this transaction: ignored by rule.", ""),
    ("failed txs indexed", PARSE, "if (!raw.meta || raw.meta.err !== null) return null;", "if (!raw.meta) return null;"),
    ("other programs indexed", PARSE, "if (keys[instruction.programIdIndex] !== programId) return;", ""),
    ("lookup-table accounts dropped", PARSE, "...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])", ""),
]
survived = []
for label, path, old, new in MUTANTS:
    src = path.read_text()
    if old not in src:
        print("PATTERN MISSING:", label); survived.append(label); continue
    path.write_text(src.replace(old, new, 1))
    try:
        out = subprocess.run("pnpm vitest run packages/indexer-core 2>&1", shell=True, cwd=ROOT, capture_output=True, text=True, timeout=400).stdout
        failed = [l.strip() for l in out.splitlines() if " FAIL " in l]
        if failed:
            print(f"caught: {label}  ({len(failed)} failing, e.g. {failed[0].split(' > ')[-1][:70]})", flush=True)
        else:
            print(f"SURVIVED: {label}", flush=True); survived.append(label)
    finally:
        path.write_text(src)
print("RESULT:", "all caught" if not survived else f"survivors: {survived}")
sys.exit(1 if survived else 0)
