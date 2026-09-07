import test from "node:test";
import assert from "node:assert/strict";
import { modelDisplay, modelOptionValue, normalizeModelCatalog, parseModelOptionValue, type RawProviderModelsResponse } from "../models";

function provider(overrides: Partial<RawProviderModelsResponse["provider"]> = {}): RawProviderModelsResponse["provider"] {
  return { id: "codex", displayName: "Codex", available: true, serviceTiers: [], ...overrides };
}

function model(overrides: Partial<RawProviderModelsResponse["models"][number]> = {}): RawProviderModelsResponse["models"][number] {
  return {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "desc",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }],
    ...overrides,
  };
}

test("normalizeModelCatalog drops unavailable providers and their models", () => {
  const result = normalizeModelCatalog([
    { provider: provider({ id: "codex", available: true }), models: [model()], modelLoadError: null },
    { provider: provider({ id: "acp-cursor", displayName: "Cursor", available: false }), models: [model({ id: "x", model: "x" })], modelLoadError: null },
  ]);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0]!.id, "codex");
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0]!.providerId, "codex");
});

test("normalizeModelCatalog dedupes by providerId/model and sorts providers by displayName then models by provider then displayName", () => {
  const result = normalizeModelCatalog([
    {
      provider: provider({ id: "zeta", displayName: "Zeta" }),
      models: [model({ id: "a", model: "a", displayName: "Alpha" }), model({ id: "a", model: "a", displayName: "Alpha (dup)" })],
      modelLoadError: null,
    },
    {
      provider: provider({ id: "alpha", displayName: "Alpha Provider" }),
      models: [model({ id: "b", model: "b", displayName: "Beta" }), model({ id: "a", model: "a", displayName: "Aardvark" })],
      modelLoadError: null,
    },
  ]);
  assert.deepEqual(result.providers.map((p) => p.id), ["alpha", "zeta"]);
  assert.deepEqual(result.models.map((m) => `${m.providerId}/${m.model}`), ["alpha/a", "alpha/b", "zeta/a"]);
  assert.equal(result.models.find((m) => m.providerId === "zeta")!.displayName, "Alpha");
});

test("normalizeModelCatalog attributes a routed model to routeProviderId, not the listing provider, and drops it when that provider was not passed in", () => {
  const result = normalizeModelCatalog([
    { provider: provider({ id: "pi", displayName: "Pi" }), models: [model({ id: "r", model: "r", routeProviderId: "codex" })], modelLoadError: null },
  ]);
  assert.equal(result.models.length, 0);

  const withRouteProvider = normalizeModelCatalog([
    { provider: provider({ id: "pi", displayName: "Pi" }), models: [model({ id: "r", model: "r", routeProviderId: "codex" })], modelLoadError: null },
    { provider: provider({ id: "codex", displayName: "Codex" }), models: [], modelLoadError: null },
  ]);
  assert.equal(withRouteProvider.models.length, 1);
  assert.equal(withRouteProvider.models[0]!.providerId, "codex");
});

test("normalizeModelCatalog caps models at 200 and providers at 50, and surfaces the first modelLoadError", () => {
  const entries: RawProviderModelsResponse[] = [];
  for (let i = 0; i < 60; i += 1) {
    entries.push({
      provider: provider({ id: `p${i}`, displayName: `Provider ${String(i).padStart(2, "0")}` }),
      models: [model({ id: `m${i}`, model: `m${i}` })],
      modelLoadError: i === 5 ? { code: "auth_required", providerId: `p${i}` } : null,
    });
  }
  const result = normalizeModelCatalog(entries);
  assert.equal(result.providers.length, 50);
  assert.ok(result.models.length <= 200);
  assert.deepEqual(result.error, { code: "auth_required", providerId: "p5" });
});

test("modelOptionValue and parseModelOptionValue round-trip, including model ids containing a slash", () => {
  assert.equal(modelOptionValue(null, null), "");
  assert.equal(modelOptionValue("pi", null), "");
  assert.equal(modelOptionValue(null, "gpt-5.5"), "");
  const value = modelOptionValue("pi", "anthropic/claude-sonnet-5");
  assert.equal(value, "pi/anthropic/claude-sonnet-5");
  assert.deepEqual(parseModelOptionValue(value), { providerId: "pi", model: "anthropic/claude-sonnet-5" });
  assert.deepEqual(parseModelOptionValue(""), { providerId: null, model: null });
});

test("modelDisplay falls back to the raw id when unknown, adds the provider name when more than one provider is present, and reports Default for no selection", () => {
  const catalog = normalizeModelCatalog([
    { provider: provider({ id: "codex", displayName: "Codex" }), models: [model({ id: "a", model: "a", displayName: "Alpha" })], modelLoadError: null },
    { provider: provider({ id: "pi", displayName: "Pi" }), models: [model({ id: "b", model: "b", displayName: "Beta" })], modelLoadError: null },
  ]);
  assert.equal(modelDisplay(catalog, null, null), "Default");
  assert.equal(modelDisplay(catalog, "codex", "missing"), "codex/missing");
  assert.equal(modelDisplay(catalog, "codex", "a"), "Codex · Alpha");

  const singleProviderCatalog = normalizeModelCatalog([
    { provider: provider({ id: "codex", displayName: "Codex" }), models: [model({ id: "a", model: "a", displayName: "Alpha" })], modelLoadError: null },
  ]);
  assert.equal(modelDisplay(singleProviderCatalog, "codex", "a"), "Alpha");
});
