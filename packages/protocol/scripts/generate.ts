/** Regenerates the typed client and the constants table from the program's IDL, and keeps a copy of the IDL. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { createFromRoot } from 'codama';

const here = dirname(fileURLToPath(import.meta.url));
const idlPath = join(here, '../../../target/idl/uproar.json');
const pkg = join(here, '..');
const out = join(pkg, 'src/generated');
const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as AnchorIdl & {
  constants?: { name: string; type: unknown; value: string }[];
};

// The build writes the IDL into target/, which stays out of git. This copy is the published interface
// for anyone building another app on the protocol, and it always matches the generated client.
mkdirSync(join(pkg, 'idl'), { recursive: true });
writeFileSync(join(pkg, 'idl/uproar.json'), readFileSync(idlPath));

rmSync(out, { recursive: true, force: true });
await createFromRoot(rootNodeFromAnchor(idl)).accept(
  renderVisitor(pkg, { generatedFolder: 'src/generated', deleteFolderBeforeRendering: true, formatCode: false, syncPackageJson: false }),
);

// Deposits and limits come from the program's own constants, never from a second hand-kept copy.
const numeric = (idl.constants ?? []).filter((c) => /^\d+$/.test(c.value.replaceAll('_', '')));
const lines = numeric.map((c) => {
  const value = c.value.replaceAll('_', '');
  const big = c.type === 'u64' || c.type === 'i64';
  return `export const ${c.name} = ${value}${big ? 'n' : ''};`;
});
writeFileSync(
  join(here, '../src/constants.generated.ts'),
  `// Generated from the program IDL by scripts/generate.ts. Do not edit.\n${lines.join('\n')}\n`,
);
console.log(`generated client and ${numeric.length} constants`);
