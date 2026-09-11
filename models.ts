// Pure normalizer for bb's provider/model catalog (bb.sdk.providers.list / .models). No bb
// imports: server.ts calls bb.sdk.providers.list, then bb.sdk.providers.models once per available
// provider (a single unscoped providers.models() call only returns one provider's catalog, per
// live verification against a running bb instance; see docs/phases/NN-models.md), and hands the
// per-provider responses to normalizeModelCatalog here.
import type { ListModelsOutput } from "./contract";

const MAX_MODELS = 1000;
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
