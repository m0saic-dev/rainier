#!/usr/bin/env node
/**
 * new-template — scaffold one template that passes every convention on the
 * first build, and wire it everywhere the repo expects.
 *
 *   node tools/new-template.mjs <pack>/<slug> [--title "Human Title"] [--description "One line."]
 *
 * Writes:
 *   src/<pack>/<slug>/v1/<slug>.ts        the template (typed props, bound
 *                                         text, fitted copy, deterministic)
 *   src/<pack>/<slug>/v1/<slug>.test.ts   locks bindings, floors, determinism
 * and appends a row to src/<pack>/registry.ts + the import / array entry /
 * `export *` in src/<pack>/index.ts. A NEW pack also gets registry.ts +
 * index.ts and is wired into src/repo.ts, src/template-registry.ts and
 * src/index.ts (and CURRICULUM.md, where one exists).
 *
 * Ordinals: the new template is appended to its pack. If that pack is not
 * the last one, every later ordinal shifts — tools/stamp-ordinals.mjs is run
 * for you where it exists.
 *
 * Then: npm run build && npm run previews && npm run build && npm run verify
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (!target || !/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(target)) {
  console.error('usage: node tools/new-template.mjs <pack>/<slug> [--title "Human Title"] [--description "One line."]\n  pack and slug: lowercase, digits, dashes.');
  process.exit(2);
}
const [pack, slug] = target.split("/");
const pascal = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };
const title = opt("--title") ?? slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const description = opt("--description") ?? `${title}: describe the ONE concept this template teaches, in one line, for the Templates page.`;
const exportName = `${pascal(slug)}V1`;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const write = (rel, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), s); touched.push(rel); };
const touched = [];

const repoId = /repoId:\s*asRepoId\("([^"]+)"\)/.exec(read("src/repo.ts"))?.[1];
if (!repoId) { console.error("new-template: could not read repoId from src/repo.ts"); process.exit(1); }
const ID = `${repoId}/${pack}/${slug}/v1`;
const STARTER = fs.existsSync(path.join(ROOT, "src/_shared/tutorial.ts"));
const packDir = `src/${pack}`;
const packExists = fs.existsSync(path.join(ROOT, packDir, "registry.ts"));
if (fs.existsSync(path.join(ROOT, packDir, slug))) { console.error(`new-template: ${packDir}/${slug} already exists`); process.exit(1); }

// ── ordinal: position in the whole repo (chapters in CHAPTERS order) ──
const chapters = [...read("src/template-registry.ts").matchAll(/\{\s*pack:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
const entriesIn = (p) => (fs.existsSync(path.join(ROOT, `src/${p}/registry.ts`)) ? (read(`src/${p}/registry.ts`).match(/^\s*slug:\s*"/gm) ?? []).length : 0);
let ordinal = 0;
for (const p of chapters) { ordinal += entriesIn(p); if (p === pack) break; }
ordinal += 1; // this template, appended to its pack
const packIsLast = !packExists || chapters[chapters.length - 1] === pack;
const NN = String(ordinal).padStart(2, "0");

// ── the template ──
const tutorialImport = STARTER ? `\nimport { lessonTutorial } from "../../../_shared/tutorial";\n` : "";
const tutorial = STARTER ? `
  renderTutorial: lessonTutorial({
    title: ${JSON.stringify(title)},
    lines: [
      "State the one concept this template teaches, in a sentence a reader can act on.",
      "Name the rule that bites - the thing that costs an afternoon when you get it wrong.",
    ],
    explore: [
      "Double-click the title on the preview - it is bound",
      "Change Page color - the backdrop follows",
    ],
  }),
` : "";
const templateTs = `import type {
  MosaicColor,
  MosaicDocument,
  MosaicEngineContext,
  MosaicSource,
} from "@m0saic/types";
import { asTemplateId } from "@m0saic/types";
import { toM0String } from "@m0saic/dsl-stdlib";
import {
  bindProp,
  defineMosaicTemplate,
  definePropsSchema,
  makeColorTile,
  placeInsetPieces,
  svgLabel,
} from "@m0saic/template-utils";
${tutorialImport}
/**
 * \`${ID}\` — one line on what it draws.
 *
 * ONE CONCEPT: the single idea, stated plainly.
 *
 * The rule that bites: the thing that will cost someone an afternoon.
 *
 * Scaffolded by tools/new-template.mjs — it passes every build-gate
 * convention as generated (typed props with defaults, a bound title,
 * fitted svg copy, deterministic geometry from ctx.target). Replace the
 * body; keep the shape.
 */

export type ${pascal(slug)}Props = {
  /** Headline - the rect that shows it is bound to it. */
  title?: string;
  /** Backdrop (#rrggbb). */
  pageColor?: string;
};

const ID = ${JSON.stringify(ID)};
const HEX = /^#[0-9a-fA-F]{6}$/;
const INK = "#eaeef2" as MosaicColor;
const DIM = "#9aa7b4" as MosaicColor;
const DEFAULT_TITLE = ${JSON.stringify(title)};

const propsSchema = definePropsSchema<${pascal(slug)}Props>({
  title: {
    type: "string",
    required: false,
    description: "Headline. The rect that shows it is bound to it, so Make's double-click edits it in place.",
    meta: { control: { placeholder: DEFAULT_TITLE }, ui: { label: "Title", order: 1 } },
  },
  pageColor: {
    type: "string",
    required: false,
    description: "Backdrop as #rrggbb.",
    meta: {
      constraints: { isColor: true },
      control: { colorPicker: true, defaultColor: "#1c2833" },
      ui: { label: "Page color", order: 2 },
    },
  },
});

export const ${exportName} = defineMosaicTemplate<${pascal(slug)}Props>({
  id: asTemplateId(ID),
  label: ${JSON.stringify(`${NN} · ${title}`)},
  version: 1,
  description: ${JSON.stringify(description)},
  capabilities: { tier: "core" },
  tags: [${JSON.stringify(pack)}, "starter"],

  outputHints: {
    width: 1280,
    height: 720,
    fps: 30,
    durationMs: 2000,
    format: { kind: "image", container: "png" },
    note: "Static card - any canvas and any duration render cleanly.",
  },

  propsSchema,
  defaultProps: {
    title: DEFAULT_TITLE,
    pageColor: "#1c2833",
  },

  async render(
    props: ${pascal(slug)}Props,
    ctx: MosaicEngineContext,
  ): Promise<MosaicDocument> {
    // The schema is documentation; render() is the gate.
    const title = props.title ?? DEFAULT_TITLE;
    if (typeof title !== "string") throw new Error(\`\${ID}: title must be a string.\`);
    if (props.pageColor !== undefined && !HEX.test(props.pageColor)) {
      throw new Error(\`\${ID}: pageColor \${JSON.stringify(props.pageColor)} must be #rrggbb.\`);
    }
    const page = (props.pageColor ?? "#1c2833") as MosaicColor;
    const { width: W, height: H } = ctx.target;
    const px = (fx: number, fy: number, fw: number, fh: number) => ({
      x: Math.round(fx * W),
      y: Math.round(fy * H),
      w: Math.round(fw * W),
      h: Math.round(fh * H),
    });

    const pieces: Parameters<typeof placeInsetPieces>[0]["pieces"] = [];
    const piece = (rect: { x: number; y: number; w: number; h: number }, importance: number, source: MosaicSource) =>
      pieces.push({ rect: { ...rect, importance }, source });

    // Backdrop - the whole canvas, painted first.
    piece(px(0, 0, 1, 1), 0, makeColorTile(page));

    // The title rect is BOUND to the prop it shows (bind what you display).
    const head = px(0.06, 0.3, 0.88, 0.2);
    piece(head, 2, bindProp(svgLabel(title || " ", head.w, head.h, { maxPx: Math.round(H * 0.08), maxLines: 1, color: INK }), "title"));

    // Static caption - not a prop, so nothing to bind.
    const cap = px(0.06, 0.6, 0.88, 0.08);
    piece(cap, 2, svgLabel("replace this scaffold with the one thing this template teaches", cap.w, cap.h, { maxPx: Math.round(H * 0.026), maxLines: 1, color: DIM }));

    const placed = placeInsetPieces({ rootW: W, rootH: H, pieces });
    return {
      kind: "mosaic_document",
      version: 1,
      m0: toM0String(placed.m0, ID),
      assets: {},
      backgroundColor: page,
      sources: placed.sources,
    };
  },
${tutorial}});

export default ${exportName};
`;

const testTs = `import { evaluateM0 } from "@m0saic/dsl-stdlib";
import { resolvePropBindings } from "@m0saic/template-utils";

import { asDocument, targetCtx } from "../../../__testutils__/render";
import { ${exportName} } from "./${slug}";

const render = (
  props: Parameters<typeof ${exportName}.render>[0] = {},
  w = 1280,
  h = 720,
) => ${exportName}.render({ ...${exportName}.defaultProps, ...props }, targetCtx(w, h)).then(asDocument);

describe(${JSON.stringify(ID)}, () => {
  it("binds the title rect to the title prop - Make's double-click edits it in place", async () => {
    const doc = await render();
    const { byProp, rejected } = resolvePropBindings(doc, 1280, 720, { propsSchema: ${exportName}.propsSchema });
    expect(rejected).toEqual([]);
    expect(byProp.title).toHaveLength(1);
  });

  it("clears its safe minimum at its own hint", async () => {
    const ev = evaluateM0(String((await render()).m0), { width: 1280, height: 720 });
    expect(ev.feasible && ev.meetsPrecision).toBe(true);
  });

  it("is deterministic and rejects a bad colour", async () => {
    expect(await render()).toEqual(await render());
    await expect(render({ pageColor: "red" })).rejects.toThrow(/#rrggbb/);
  });
});
`;
write(`${packDir}/${slug}/v1/${slug}.ts`, templateTs);
write(`${packDir}/${slug}/v1/${slug}.test.ts`, testTs);

// ── registry row ──
const row = `  {
    slug: ${JSON.stringify(slug)},
    templateId: ${JSON.stringify(ID)},
    exportName: ${JSON.stringify(exportName)},
    title: ${JSON.stringify(`${NN} · ${title}`)},
    description:
      ${JSON.stringify(description)},
    tags: [${JSON.stringify(pack)}, "starter"],
  },
`;
const registryVar = `${camel(pack)}Registry`;
const templatesVar = `${camel(pack)}Templates`;
if (packExists) {
  const rel = `${packDir}/registry.ts`;
  const s = read(rel);
  const i = s.lastIndexOf("];");
  if (i < 0) { console.error(`new-template: ${rel} has no closing ];`); process.exit(1); }
  write(rel, s.slice(0, i) + row + s.slice(i));
  const irel = `${packDir}/index.ts`;
  let idx = read(irel);
  const importLine = `import { ${exportName} } from "./${slug}/v1/${slug}";\n`;
  const lastImport = idx.lastIndexOf("\nimport {");
  const lastImportEnd = idx.indexOf("\n", idx.indexOf(";", lastImport)) + 1;
  idx = idx.slice(0, lastImportEnd) + importLine + idx.slice(lastImportEnd);
  const arr = idx.indexOf(`export const ${templatesVar}`);
  const close = idx.indexOf("];", arr);
  idx = idx.slice(0, close) + `  ${exportName} as unknown as MosaicTemplate<MosaicTemplateProps>,\n` + idx.slice(close);
  idx = idx.trimEnd() + `\nexport * from "./${slug}/v1/${slug}";\n`;
  write(irel, idx);
} else {
  write(`${packDir}/registry.ts`, `import type { StarterRegistryEntry } from "../registry-types";

/**
 * ${STARTER ? "Chapter" : "Pack"} registry: \`${pack}\` — array order is the ${STARTER ? "teaching" : "display"} order.
 */
export const ${registryVar}: StarterRegistryEntry[] = [
${row}];
`);
  write(`${packDir}/index.ts`, `import type { MosaicTemplate, MosaicTemplateProps } from "@m0saic/types";

import { ${exportName} } from "./${slug}/v1/${slug}";

/** ${STARTER ? "Chapter" : "Pack"} \`${pack}\`, in registry order (mirrors ./registry.ts). */
export const ${templatesVar}: MosaicTemplate<MosaicTemplateProps>[] = [
  ${exportName} as unknown as MosaicTemplate<MosaicTemplateProps>,
];

// \`export *\` ONLY — see the note in src/index.ts.
export * from "./${slug}/v1/${slug}";
`);
  // repo.ts pack descriptor
  let repo = read("src/repo.ts");
  const packsClose = repo.indexOf("];", repo.indexOf("TEMPLATE_PACKS"));
  repo = repo.slice(0, packsClose) + `  {
    id: ${JSON.stringify(pack)},
    title: ${JSON.stringify(pascal(pack).replace(/([A-Z])/g, " $1").trim())},
    description:
      ${JSON.stringify(`${pascal(pack)}: one line on what this pack teaches.`)},
  },
` + repo.slice(packsClose);
  write("src/repo.ts", repo);
  // template-registry.ts
  let tr = read("src/template-registry.ts");
  const lastReg = tr.lastIndexOf('/registry";');
  const lastRegEnd = tr.indexOf("\n", lastReg) + 1;
  tr = tr.slice(0, lastRegEnd) + `import { ${registryVar} } from "./${pack}/registry";\n` + tr.slice(lastRegEnd);
  const chClose = tr.indexOf("];", tr.indexOf("CHAPTERS"));
  tr = tr.slice(0, chClose) + `  { pack: ${JSON.stringify(pack)}, entries: ${registryVar} },\n` + tr.slice(chClose);
  write("src/template-registry.ts", tr);
  // src/index.ts
  let ix = read("src/index.ts");
  const lastTplImport = ix.lastIndexOf('Templates } from "./');
  const lastTplImportEnd = ix.indexOf("\n", lastTplImport) + 1;
  ix = ix.slice(0, lastTplImportEnd) + `import { ${templatesVar} } from "./${pack}";\n` + ix.slice(lastTplImportEnd);
  const arrClose = ix.indexOf("];", ix.indexOf("export const templates"));
  ix = ix.slice(0, arrClose) + `  ...${templatesVar},\n` + ix.slice(arrClose);
  const lastExport = ix.lastIndexOf('export * from "./');
  const lastExportEnd = ix.indexOf("\n", lastExport) + 1;
  ix = ix.slice(0, lastExportEnd) + `export * from "./${pack}";\n` + ix.slice(lastExportEnd);
  write("src/index.ts", ix);
  // CURRICULUM.md (starter): the dep policy lints for a `## <pack>` heading
  if (fs.existsSync(path.join(ROOT, "CURRICULUM.md"))) {
    let cur = read("CURRICULUM.md");
    const section = `## ${pack}\n\nWhat this chapter teaches, in a paragraph.\n\n| # | Template | id |\n|---|---|---|\n| ${ordinal} | ${title} | \`${pack}/${slug}/v1\` |\n`;
    const anchor = "\n---\n\n## What is not here yet\n";
    cur = cur.includes(anchor) ? cur.replace(anchor, `\n${section}${anchor}`) : cur.trimEnd() + `\n\n${section}`;
    write("CURRICULUM.md", cur);
  }
}
if (STARTER && packExists) {
  // append the CURRICULUM row to the chapter's table
  const rel = "CURRICULUM.md";
  if (fs.existsSync(path.join(ROOT, rel))) {
    const cur = read(rel);
    const h = cur.indexOf(`\n## ${pack}\n`);
    if (h >= 0) {
      const tableEnd = (() => { let i = cur.indexOf("\n|", h); let last = -1; while (i >= 0 && i < (cur.indexOf("\n## ", h + 1) < 0 ? cur.length : cur.indexOf("\n## ", h + 1))) { last = i; i = cur.indexOf("\n|", i + 1); } return last; })();
      if (tableEnd >= 0) {
        const lineEnd = cur.indexOf("\n", tableEnd + 1);
        write(rel, cur.slice(0, lineEnd) + `\n| ${ordinal} | ${title} | \`${pack}/${slug}/v1\` |` + cur.slice(lineEnd));
      }
    }
  }
}

// ── ordinals: a non-last pack shifts everything after it ──
if (!packIsLast && fs.existsSync(path.join(ROOT, "tools/stamp-ordinals.mjs"))) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/stamp-ordinals.mjs")], { stdio: "inherit" });
  if (r.status !== 0) console.warn("new-template: stamp-ordinals reported a problem — check ordinals before building.");
}

console.log(`new-template: ${ID}  (${NN} · ${title})`);
for (const f of touched) console.log(`  ${fs.existsSync(path.join(ROOT, f)) ? "wrote" : "?"}  ${f}`);
console.log("\nNext:\n  npm run build && npm run previews && npm run build && npm run fingerprints:update && npm run verify\n  then edit " + `${packDir}/${slug}/v1/${slug}.ts` + " — the header comment is the lesson; " + `${slug}.layout.m0` + " beside it is the layout fingerprint.");
