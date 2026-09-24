/**
 * Generate template-manifest.json from the authoring registry.
 *
 * Usage:  node dist/gen-template-manifest.js   (the build runs it for you)
 *
 * The manifest is the ZERO-EXEC browse surface: hosts list, filter, and
 * preview this repo's templates from it without importing any code. This
 * generator keeps it honest:
 *   - every registry row's templateId parses as <repoId>/<pack>/<slug>/vN
 *     (repoId from src/repo.ts — the ONE place a fork renames itself),
 *     with the pack declared in TEMPLATE_PACKS and a real src/<pack>/<slug>/vN/;
 *   - slugs unique per pack; templateIds and exportNames globally unique;
 *   - the registry and the exported `templates[]` agree EXACTLY — a template
 *     can't ship unregistered, and a registry row can't outlive its template;
 *   - preview assets referenced (explicitly or by convention) must exist.
 *
 * `buildStarterManifest()` is pure — the freshness test diffs it against the
 * generated JSON on disk so a stale manifest can't slip through review.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type {
  MosaicTemplateRepoManifest,
  MosaicTemplateRepoManifestEntry,
} from "@m0saic/types";

import { templateRegistry, CHAPTERS } from "./template-registry";
import { TEMPLATE_REPO, TEMPLATE_PACKS } from "./repo";
import { templates } from "./index";

const ROOT = path.resolve(__dirname, "..");

const TEMPLATES_DIR = TEMPLATE_REPO.assets?.templatesDir ?? "assets/templates";
const ENTRY_MODULE = "./dist/index.js";

/**
 * Local id parser — deliberately NOT the platform's parseTemplateId, so this
 * file compiles to a dist script with no @m0saic/* value imports and the
 * whole build stays runnable anywhere the repo builds.
 */
// The id namespace comes from ONE place — src/repo.ts. Fork this repo,
// change repoId there, and every gate below follows automatically.
const REPO_PREFIX = TEMPLATE_REPO.repoId as unknown as string;
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STARTER_ID_RE = new RegExp(
  `^${escapeRe(REPO_PREFIX)}\\/([a-z0-9][a-z0-9-]*)\\/([a-z0-9][a-z0-9-]*)\\/v([1-9]\\d*)$`,
);

type TemplateKey = MosaicTemplateRepoManifestEntry["templateKey"];

/* ── Helpers ─────────────────────────────────────────────── */

function encodeTemplateKey(templateKey: string): string {
  return templateKey.replace(/\//g, "__");
}

function existsRepoRel(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ensurePreviewPathsExist(
  preview: MosaicTemplateRepoManifestEntry["preview"] | undefined,
  templateKey: string,
) {
  if (!preview) return;
  const check = (p: string | undefined, field: string) => {
    if (!p) return;
    assert(
      existsRepoRel(p),
      `Template "${templateKey}" preview.${field} points to missing file: "${p}"`,
    );
  };
  check(preview.image, "image");
  check(preview.video, "video");
  check(preview.poster, "poster");
}

function buildPreviewFromConvention(
  templateKey: string,
): MosaicTemplateRepoManifestEntry["preview"] | undefined {
  const baseDir = `${TEMPLATES_DIR}/${encodeTemplateKey(templateKey)}`;

  const image = `${baseDir}/preview.png`;
  const video = `${baseDir}/preview.mp4`;
  const poster = `${baseDir}/poster.png`;

  const preview: NonNullable<MosaicTemplateRepoManifestEntry["preview"]> = {};
  if (existsRepoRel(image)) preview.image = image;
  if (existsRepoRel(video)) preview.video = video;
  if (existsRepoRel(poster)) preview.poster = poster;

  return preview.image || preview.video || preview.poster ? preview : undefined;
}

function mergePreview(
  explicit: MosaicTemplateRepoManifestEntry["preview"] | undefined,
  fallback: MosaicTemplateRepoManifestEntry["preview"] | undefined,
): MosaicTemplateRepoManifestEntry["preview"] | undefined {
  if (!explicit && !fallback) return undefined;
  const merged = {
    image: explicit?.image ?? fallback?.image,
    video: explicit?.video ?? fallback?.video,
    poster: explicit?.poster ?? fallback?.poster,
  };
  return merged.image || merged.video || merged.poster ? merged : undefined;
}

/* ── Build (pure — also consumed by the freshness test) ───── */

export function buildStarterManifest(): MosaicTemplateRepoManifest {
  const packIds = new Set(TEMPLATE_PACKS.map((p) => p.id));

  /* Chapter provenance: each registry row lives in the chapter whose pack
   * matches its id's <pack> segment. */
  for (const chapter of CHAPTERS) {
    assert(
      packIds.has(chapter.pack),
      `CHAPTERS declares pack "${chapter.pack}" which is not in TEMPLATE_PACKS`,
    );
    for (const entry of chapter.entries) {
      const parsed = STARTER_ID_RE.exec(entry.templateId);
      assert(
        parsed,
        `Entry "${entry.templateId}" does not match "${REPO_PREFIX}/<pack>/<slug>/vN"`,
      );
      assert(
        parsed[1] === chapter.pack,
        `Entry "${entry.templateId}" is registered under chapter "${chapter.pack}" ` +
          `but its id says pack "${parsed[1]}"`,
      );
    }
  }

  /* Row validation + uniqueness. */
  const seenSlugKeys = new Set<string>();
  const seenTemplateIds = new Set<string>();
  const seenExports = new Set<string>();

  /* Curriculum ordinals. Browse UIs sort by name or slug, so array order
   * never reaches the reader — the number in the title is what carries the
   * reading order across. It is derived from CHAPTERS order here and only
   * CHECKED against what the files say, so a renumber is a build error
   * rather than a silent disagreement. */
  const labelById = new Map(templates.map((t) => [String(t.id), String(t.label ?? "")]));
  const ordinalOf = (index: number): string => String(index + 1).padStart(2, "0");

  for (const [index, entry] of templateRegistry.entries()) {
    const expected = `${ordinalOf(index)} · `;
    assert(
      entry.title.startsWith(expected),
      `Entry "${entry.templateId}" is #${ordinalOf(index)} in curriculum order, so its ` +
        `title must start with "${expected}" — got "${entry.title}"`,
    );
    const label = labelById.get(entry.templateId);
    assert(
      label === undefined || label.startsWith(expected),
      `Template "${entry.templateId}" label must start with "${expected}" to match its ` +
        `registry row — got "${label}"`,
    );
  }

  for (const entry of templateRegistry) {
    const parsed = STARTER_ID_RE.exec(entry.templateId);
    assert(parsed, `Entry "${entry.templateId}" has an invalid id`);
    const [, packId, slugFromId, major] = parsed;

    assert(
      entry.slug === slugFromId,
      `Entry "${entry.templateId}" slug field "${entry.slug}" != id slug "${slugFromId}"`,
    );
    assert(
      packIds.has(packId),
      `Entry "${entry.templateId}" pack "${packId}" is not declared in TEMPLATE_PACKS`,
    );

    const srcDir = `src/${packId}/${entry.slug}/v${major}`;
    assert(
      fs.existsSync(path.join(ROOT, srcDir)),
      `Entry "${entry.templateId}" has no source folder "${srcDir}/"`,
    );

    const slugKey = `${packId}/${entry.slug}`;
    assert(!seenSlugKeys.has(slugKey), `Duplicate pack-scoped slug: "${slugKey}"`);
    seenSlugKeys.add(slugKey);

    assert(
      !seenTemplateIds.has(entry.templateId),
      `Duplicate templateId: "${entry.templateId}"`,
    );
    seenTemplateIds.add(entry.templateId);

    assert(entry.exportName, `Entry "${entry.slug}" missing exportName`);
    assert(!seenExports.has(entry.exportName), `Duplicate exportName: "${entry.exportName}"`);
    seenExports.add(entry.exportName);

    assert(
      Array.isArray(entry.tags) && entry.tags.length > 0,
      `Entry "${entry.templateId}" needs at least one tag`,
    );
  }

  /* Every declared pack must teach something. */
  for (const pack of TEMPLATE_PACKS) {
    const used = templateRegistry.some((e) => e.templateId.startsWith(`${REPO_PREFIX}/${pack.id}/`));
    assert(used, `TEMPLATE_PACKS declares "${pack.id}" but no registry entry uses it`);
  }

  /* Registry ↔ exports must agree exactly. */
  const exportedIds = new Set(templates.map((t) => String(t.id)));
  for (const id of seenTemplateIds) {
    assert(exportedIds.has(id), `Registry entry "${id}" has no exported template`);
  }
  for (const id of exportedIds) {
    assert(seenTemplateIds.has(id), `Exported template "${id}" has no registry entry`);
  }

  /* Manifest entries, in curriculum order. */
  const manifestEntries: MosaicTemplateRepoManifestEntry[] = templateRegistry.map(
    (entry): MosaicTemplateRepoManifestEntry => {
      const templateKey = entry.templateId;
      const parsed = STARTER_ID_RE.exec(templateKey);
      assert(parsed, `unreachable: "${templateKey}" re-validated`);

      ensurePreviewPathsExist(entry.preview, templateKey);
      const preview = mergePreview(
        entry.preview,
        buildPreviewFromConvention(templateKey),
      );
      if (preview?.video && !preview.poster) {
        preview.poster = preview.video;
      }

      return {
        slug: entry.slug,
        templateKey: templateKey as TemplateKey,
        title: entry.title,
        description: entry.description,
        tags: entry.tags,
        pack: parsed[1],
        preview,
      };
    },
  );

  return {
    schemaVersion: 1,
    repo: TEMPLATE_REPO,
    entryModule: ENTRY_MODULE,
    templates: manifestEntries,
    packs: TEMPLATE_PACKS,
  };
}

/* ── Write (build-script entrypoint) ─────────────────────── */

if (require.main === module) {
  const manifest = buildStarterManifest();
  const outPath = path.join(ROOT, "template-manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const previewCount = manifest.templates.filter((t) => t.preview).length;
  console.log(
    `[gen-template-manifest] wrote ${path.relative(ROOT, outPath)} ` +
      `(${manifest.templates.length} templates, ${manifest.packs?.length ?? 0} packs, ` +
      `${previewCount} with preview assets)`,
  );
}
