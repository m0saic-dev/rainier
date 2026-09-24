/**
 * Substrate stubs for the no-install contract check (tools/contract-check.mjs).
 *
 * The built dist/ `require()`s "@m0saic/types", "@m0saic/template-utils",
 * etc. at load time, and the check must run without the substrate on disk.
 * This shim patches Module._load so those specifiers resolve to an identity
 * proxy: every property access yields another proxy, and every call returns
 * its FIRST argument. That is exactly right for the substrate's module-scope
 * surface — `defineMosaicTemplate(def)` -> def, `definePropsSchema(s)` -> s,
 * `asTemplateId(x)` -> x — so template modules evaluate and the check can
 * inspect the exported objects STRUCTURALLY. Nothing here renders.
 *
 * Deliberately NOT a sandbox and not a mock framework: if a template does
 * real work at module scope (against the style law), the proxy may hand it
 * nonsense — which is a feature, because the deep check (--deep, with the
 * real substrate installed) will disagree and flag it.
 */
"use strict";

const Module = require("node:module");

function makeStub() {
  const fn = (...args) => args[0];
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => "[m0saic-substrate-stub]";
      if (prop === "toString") return () => "[m0saic-substrate-stub]";
      if (prop === "default") return makeStub();
      return makeStub();
    },
  });
}

function isStubbedSpecifier(request) {
  return (
    request === "sharp" ||
    request.startsWith("sharp/") ||
    request === "@twemoji/svg" ||
    request.startsWith("@twemoji/svg/") ||
    request.startsWith("@m0saic/")
  );
}

function installStubs() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (isStubbedSpecifier(request)) return makeStub();
    return originalLoad.call(this, request, parent, isMain);
  };
}

module.exports = { installStubs, makeStub, isStubbedSpecifier };
