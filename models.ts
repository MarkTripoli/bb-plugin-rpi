// Pure normalizer for bb's provider/model catalog (bb.sdk.providers.list / .models). No bb
// imports: server.ts calls bb.sdk.providers.list, then bb.sdk.providers.models once per available
// provider (a single unscoped providers.models() call only returns one provider's catalog, per
// live verification against a running bb instance; see docs/phases/NN-models.md), and hands the
// per-provider responses to normalizeModelCatalog here.
import type { ListModelsOutput } from "./contract";

const MAX_MODELS = 200;
const MAX_PROVIDERS = 50;

export interface RawCatalogModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
  // Present when the model routes through a different provider than the one whose catalog listed
  // it; that routing provider is the one bb actually spawns the thread against.
  routeProviderId?: string;
}

export interface RawCatalogProvider {
  id: string;
  displayName: string;
  available: boolean;
  serviceTiers?: Array<{ id: string; label: string }>;
}

export interface RawProviderModelsResponse {
  provider: RawCatalogProvider;
  models: RawCatalogModel[];
  modelLoadError: { code: string; providerId: string } | null;
}

export type { ListModelsOutput };

// Merges one bb.sdk.providers.models() response per available provider into the contract's
// deduped, sorted, bounded catalog shape. Keeps only models whose provider is available; a model
// with routeProviderId is attributed to that routing provider instead of the one that listed it,
// falling back to the listing provider when the route target was not itself passed in (dropped by
// the "available" filter below rather than guessed at).
export function normalizeModelCatalog(entries: RawProviderModelsResponse[]): ListModelsOutput {
  const providerById = new Map<string, ListModelsOutput["providers"][number]>();
  let error: ListModelsOutput["error"] = null;

  for (const entry of entries) {
    if (!error && entry.modelLoadError) error = entry.modelLoadError;
    if (!entry.provider.available) continue;
    if (!providerById.has(entry.provider.id)) {
      providerById.set(entry.provider.id, {
        id: entry.provider.id,
        displayName: entry.provider.displayName,
        available: entry.provider.available,
        serviceTiers: (entry.provider.serviceTiers ?? []).map((tier) => ({ id: tier.id, label: tier.label })),
      });
    }
  }

  const providers = [...providerById.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, MAX_PROVIDERS);
  const providerOrder = new Map(providers.map((provider, index) => [provider.id, index]));

  const modelByKey = new Map<string, ListModelsOutput["models"][number]>();
  for (const entry of entries) {
    if (!entry.provider.available) continue;
    for (const model of entry.models) {
      const providerId = model.routeProviderId ?? entry.provider.id;
      if (!providerOrder.has(providerId)) continue;
      const key = `${providerId}/${model.model}`;
      if (modelByKey.has(key)) continue;
      modelByKey.set(key, {
        id: model.id,
        model: model.model,
        providerId,
        displayName: model.displayName,
        description: model.description,
        isDefault: model.isDefault,
        defaultReasoningEffort: model.defaultReasoningEffort,
        reasoningEfforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      });
    }
  }

  const models = [...modelByKey.values()]
    .sort((a, b) => {
      const orderDiff = (providerOrder.get(a.providerId) ?? 0) - (providerOrder.get(b.providerId) ?? 0);
      return orderDiff !== 0 ? orderDiff : a.displayName.localeCompare(b.displayName);
    })
    .slice(0, MAX_MODELS);

  return { providers, models, error };
}

// "" when either half is missing (the "inherit/default" option value); otherwise the option
// value bb's own catalog is keyed by. Model ids can contain "/" (e.g. "anthropic/claude-sonnet-5"
// under provider "pi"), so this is not itself round-trippable by splitting on every "/"; see
// parseModelOptionValue, which splits on the first one only.
export function modelOptionValue(providerId: string | null, model: string | null): string {
  if (!providerId || !model) return "";
  return `${providerId}/${model}`;
}

export function parseModelOptionValue(value: string): { providerId: string | null; model: string | null } {
  if (!value) return { providerId: null, model: null };
  const separatorIndex = value.indexOf("/");
  if (separatorIndex === -1) return { providerId: value, model: null };
  return { providerId: value.slice(0, separatorIndex), model: value.slice(separatorIndex + 1) };
}

// Display text for a task's/prefs' chosen model. Falls back to the raw "providerId/model" when
// the catalog does not have it (e.g. saved before that provider was installed), and to "Default"
// when nothing was chosen at all.
export function modelDisplay(catalog: ListModelsOutput, providerId: string | null, model: string | null): string {
  if (!providerId || !model) return "Default";
  const match = catalog.models.find((entry) => entry.providerId === providerId && entry.model === model);
  if (!match) return `${providerId}/${model}`;
  const provider = catalog.providers.find((entry) => entry.id === providerId);
  const multipleProviders = new Set(catalog.models.map((entry) => entry.providerId)).size > 1;
  return multipleProviders && provider ? `${provider.displayName} · ${match.displayName}` : match.displayName;
}
