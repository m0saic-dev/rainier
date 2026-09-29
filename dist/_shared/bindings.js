"use strict";
/**
 * `template.bindings.unbound` — the "declared" half of the 0.3.0 roll call.
 *
 * m0saic 0.3.0 (`bindingsDeclared`, a build-time THROW) wants every prop that
 * CAN carry a canvas handle either bound on the rect that shows it
 * (`bindProp` / `bindProps` / `bindPropPath` / `bindPropRect`), or named in
 * `template.bindings.unbound` with one honest word for why no rect shows it
 * (`{ fps: "timing" }`). Booleans, closed sets (oneOf / options / pickers),
 * groups, the m0 family and code never count, and a colour that IS the
 * document background needs nothing.
 *
 * `@m0saic/types` 0.2.0 has no `bindings` field yet, so a template spreads
 * this into its `defineMosaicTemplate({ ... })` input:
 *
 *   defineMosaicTemplate<P>({ id, ..., ...declareBindings({ takes: "timing" }) })
 *
 * `defineMosaicTemplate` keeps keys it does not know (it returns
 * `{ ...template, ... }`), and the 0.3.0 audit reads
 * `template.bindings.unbound` from that object. Once the repo depends on
 * `@m0saic/types ^0.3.0` a NEW template may write the plain field instead;
 * a template that already calls this keeps working unchanged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.declareBindings = declareBindings;
exports.unboundOf = unboundOf;
/** `{ bindings: { unbound } }`, typed as a plain object so it spreads into a 0.2.0 template literal. */
function declareBindings(unbound) {
    return { bindings: { unbound: { ...unbound } } };
}
/** Read a template's declaration back (tests, tools). Absent → `{}`. */
function unboundOf(template) {
    var _a;
    const bindings = template.bindings;
    return (_a = bindings === null || bindings === void 0 ? void 0 : bindings.unbound) !== null && _a !== void 0 ? _a : {};
}
