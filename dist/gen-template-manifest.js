"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStarterManifest = buildStarterManifest;
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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const template_registry_1 = require("./template-registry");
const repo_1 = require("./repo");
const index_1 = require("./index");
const ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = (_b = (_a = repo_1.TEMPLATE_REPO.assets) === null || _a === void 0 ? void 0 : _a.templatesDir) !== null && _b !== void 0 ? _b : "assets/templates";
const ENTRY_MODULE = "./dist/index.js";
/**
 * Local id parser — deliberately NOT the platform's parseTemplateId, so this
 * file compiles to a dist script with no @m0saic/* value imports and the
 * whole build stays runnable anywhere the repo builds.
 */
// The id namespace comes from ONE place — src/repo.ts. Fork this repo,
// change repoId there, and every gate below follows automatically.
const REPO_PREFIX = repo_1.TEMPLATE_REPO.repoId;
const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STARTER_ID_RE = new RegExp(`^${escapeRe(REPO_PREFIX)}\\/([a-z0-9][a-z0-9-]*)\\/([a-z0-9][a-z0-9-]*)\\/v([1-9]\\d*)$`);
/* ── Helpers ─────────────────────────────────────────────── */
function encodeTemplateKey(templateKey) {
    return templateKey.replace(/\//g, "__");
}
function existsRepoRel(relPath) {
    return fs.existsSync(path.join(ROOT, relPath));
}
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
function ensurePreviewPathsExist(preview, templateKey) {
    if (!preview)
        return;
    const check = (p, field) => {
        if (!p)
            return;
        assert(existsRepoRel(p), `Template "${templateKey}" preview.${field} points to missing file: "${p}"`);
    };
    check(preview.image, "image");
    check(preview.video, "video");
    check(preview.poster, "poster");
}
function buildPreviewFromConvention(templateKey) {
    const baseDir = `${TEMPLATES_DIR}/${encodeTemplateKey(templateKey)}`;
    const image = `${baseDir}/preview.png`;
    const video = `${baseDir}/preview.mp4`;
    const poster = `${baseDir}/poster.png`;
    const preview = {};
    if (existsRepoRel(image))
        preview.image = image;
    if (existsRepoRel(video))
        preview.video = video;
    if (existsRepoRel(poster))
        preview.poster = poster;
    return preview.image || preview.video || preview.poster ? preview : undefined;
}
function mergePreview(explicit, fallback) {
    var _a, _b, _c;
    if (!explicit && !fallback)
        return undefined;
    const merged = {
        image: (_a = explicit === null || explicit === void 0 ? void 0 : explicit.image) !== null && _a !== void 0 ? _a : fallback === null || fallback === void 0 ? void 0 : fallback.image,
        video: (_b = explicit === null || explicit === void 0 ? void 0 : explicit.video) !== null && _b !== void 0 ? _b : fallback === null || fallback === void 0 ? void 0 : fallback.video,
        poster: (_c = explicit === null || explicit === void 0 ? void 0 : explicit.poster) !== null && _c !== void 0 ? _c : fallback === null || fallback === void 0 ? void 0 : fallback.poster,
    };
    return merged.image || merged.video || merged.poster ? merged : undefined;
}
/* ── Build (pure — also consumed by the freshness test) ───── */
function buildStarterManifest() {
    const packIds = new Set(repo_1.TEMPLATE_PACKS.map((p) => p.id));
    /* Chapter provenance: each registry row lives in the chapter whose pack
     * matches its id's <pack> segment. */
    for (const chapter of template_registry_1.CHAPTERS) {
        assert(packIds.has(chapter.pack), `CHAPTERS declares pack "${chapter.pack}" which is not in TEMPLATE_PACKS`);
        for (const entry of chapter.entries) {
            const parsed = STARTER_ID_RE.exec(entry.templateId);
            assert(parsed, `Entry "${entry.templateId}" does not match "${REPO_PREFIX}/<pack>/<slug>/vN"`);
            assert(parsed[1] === chapter.pack, `Entry "${entry.templateId}" is registered under chapter "${chapter.pack}" ` +
                `but its id says pack "${parsed[1]}"`);
        }
    }
    /* Row validation + uniqueness. */
    const seenSlugKeys = new Set();
    const seenTemplateIds = new Set();
    const seenExports = new Set();
    /* Curriculum ordinals. Browse UIs sort by name or slug, so array order
     * never reaches the reader — the number in the title is what carries the
     * reading order across. It is derived from CHAPTERS order here and only
     * CHECKED against what the files say, so a renumber is a build error
     * rather than a silent disagreement. */
    const labelById = new Map(index_1.templates.map((t) => { var _a; return [String(t.id), String((_a = t.label) !== null && _a !== void 0 ? _a : "")]; }));
    const ordinalOf = (index) => String(index + 1).padStart(2, "0");
    for (const [index, entry] of template_registry_1.templateRegistry.entries()) {
        const expected = `${ordinalOf(index)} · `;
        assert(entry.title.startsWith(expected), `Entry "${entry.templateId}" is #${ordinalOf(index)} in curriculum order, so its ` +
            `title must start with "${expected}" — got "${entry.title}"`);
        const label = labelById.get(entry.templateId);
        assert(label === undefined || label.startsWith(expected), `Template "${entry.templateId}" label must start with "${expected}" to match its ` +
            `registry row — got "${label}"`);
    }
    for (const entry of template_registry_1.templateRegistry) {
        const parsed = STARTER_ID_RE.exec(entry.templateId);
        assert(parsed, `Entry "${entry.templateId}" has an invalid id`);
        const [, packId, slugFromId, major] = parsed;
        assert(entry.slug === slugFromId, `Entry "${entry.templateId}" slug field "${entry.slug}" != id slug "${slugFromId}"`);
        assert(packIds.has(packId), `Entry "${entry.templateId}" pack "${packId}" is not declared in TEMPLATE_PACKS`);
        const srcDir = `src/${packId}/${entry.slug}/v${major}`;
        assert(fs.existsSync(path.join(ROOT, srcDir)), `Entry "${entry.templateId}" has no source folder "${srcDir}/"`);
        const slugKey = `${packId}/${entry.slug}`;
        assert(!seenSlugKeys.has(slugKey), `Duplicate pack-scoped slug: "${slugKey}"`);
        seenSlugKeys.add(slugKey);
        assert(!seenTemplateIds.has(entry.templateId), `Duplicate templateId: "${entry.templateId}"`);
        seenTemplateIds.add(entry.templateId);
        assert(entry.exportName, `Entry "${entry.slug}" missing exportName`);
        assert(!seenExports.has(entry.exportName), `Duplicate exportName: "${entry.exportName}"`);
        seenExports.add(entry.exportName);
        assert(Array.isArray(entry.tags) && entry.tags.length > 0, `Entry "${entry.templateId}" needs at least one tag`);
    }
    /* Every declared pack must teach something. */
    for (const pack of repo_1.TEMPLATE_PACKS) {
        const used = template_registry_1.templateRegistry.some((e) => e.templateId.startsWith(`${REPO_PREFIX}/${pack.id}/`));
        assert(used, `TEMPLATE_PACKS declares "${pack.id}" but no registry entry uses it`);
    }
    /* Registry ↔ exports must agree exactly. */
    const exportedIds = new Set(index_1.templates.map((t) => String(t.id)));
    for (const id of seenTemplateIds) {
        assert(exportedIds.has(id), `Registry entry "${id}" has no exported template`);
    }
    for (const id of exportedIds) {
        assert(seenTemplateIds.has(id), `Exported template "${id}" has no registry entry`);
    }
    /* Manifest entries, in curriculum order. */
    const manifestEntries = template_registry_1.templateRegistry.map((entry) => {
        const templateKey = entry.templateId;
        const parsed = STARTER_ID_RE.exec(templateKey);
        assert(parsed, `unreachable: "${templateKey}" re-validated`);
        ensurePreviewPathsExist(entry.preview, templateKey);
        const preview = mergePreview(entry.preview, buildPreviewFromConvention(templateKey));
        if ((preview === null || preview === void 0 ? void 0 : preview.video) && !preview.poster) {
            preview.poster = preview.video;
        }
        return {
            slug: entry.slug,
            templateKey: templateKey,
            title: entry.title,
            description: entry.description,
            tags: entry.tags,
            pack: parsed[1],
            preview,
        };
    });
    return {
        schemaVersion: 1,
        repo: repo_1.TEMPLATE_REPO,
        entryModule: ENTRY_MODULE,
        templates: manifestEntries,
        packs: repo_1.TEMPLATE_PACKS,
    };
}
/* ── Write (build-script entrypoint) ─────────────────────── */
if (require.main === module) {
    const manifest = buildStarterManifest();
    const outPath = path.join(ROOT, "template-manifest.json");
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const previewCount = manifest.templates.filter((t) => t.preview).length;
    console.log(`[gen-template-manifest] wrote ${path.relative(ROOT, outPath)} ` +
        `(${manifest.templates.length} templates, ${(_d = (_c = manifest.packs) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0} packs, ` +
        `${previewCount} with preview assets)`);
}
