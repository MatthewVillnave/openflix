import { ConnectorError } from '@openflix/connector-core';
import type { ClientProfile, ManagedMediaConnector, PlaybackInfo } from '@openflix/connector-core';
import type { OpenFlixDatabase, StoredConnector } from '@openflix/database';
import type { CatalogItem } from '@openflix/shared';
export class SourceSelectionError extends Error {
  constructor(readonly code: 'selection_required' | 'source_changed' | 'no_compatible_source') {
    super(
      code === 'selection_required'
        ? 'Choose an explicit source/version.'
        : code === 'source_changed'
          ? 'The selected source changed. Choose again.'
          : 'No compatible source was available among the first four candidates. Choose a source explicitly.',
    );
  }
}
export interface Selection {
  item: CatalogItem;
  connector: ManagedMediaConnector;
  plan: PlaybackInfo;
  binding?: { workId: string; versionKey: string };
}
export async function selectSource(
  db: OpenFlixDatabase,
  request: { itemId?: string; groupId?: string; sourceItemId?: string; profile: ClientProfile },
  permitted: () => boolean,
  create: (record: StoredConnector) => ManagedMediaConnector,
  cleanupFailed: () => void,
): Promise<Selection> {
  const check = () => {
    if (!permitted()) throw new ConnectorError('cancelled');
  };
  check();
  const group = request.groupId ? db.works.work(request.groupId) : undefined;
  if (request.groupId && !group) throw new ConnectorError('not_found');
  if (group && !request.sourceItemId && db.works.versionCount(group.id) > 1)
    throw new SourceSelectionError('selection_required');
  const ids = group
    ? request.sourceItemId
      ? [request.sourceItemId]
      : db.works.sources(group.id, 0, 4).items.map((i) => i.itemId)
    : [request.itemId!];
  let best: Selection | undefined;
  const rank = { direct: 0, remux: 1, transcode: 2 };
  const dispose = async (s: Selection) => {
    try {
      await s.connector.closePlayback(s.plan);
    } catch {
      cleanupFailed();
    }
  };
  const valid = (s: Selection) => {
    check();
    if (!db.getConnector(s.item.connectorId) || !db.catalog.item(s.item.id))
      throw new SourceSelectionError('source_changed');
    if (s.binding) {
      const current = db.works.binding(s.item.id);
      if (current?.workId !== s.binding.workId || current.versionKey !== s.binding.versionKey)
        throw new SourceSelectionError('source_changed');
    }
  };
  try {
    for (const id of ids) {
      check();
      const item = db.catalog.item(id),
        binding = group ? db.works.binding(id) : undefined;
      if (!item || (group && binding?.workId !== group.id)) throw new ConnectorError('not_found');
      if (!['movie', 'episode', 'audio'].includes(item.type))
        throw new ConnectorError('unsupported');
      const record = db.getConnector(item.connectorId);
      if (!record) throw new ConnectorError('not_found');
      const connector = create(record);
      let candidate: Selection | undefined;
      try {
        const plan = await connector.getPlaybackInfo(
          item.upstreamId,
          request.profile,
          group ? { singleVersionOnly: true } : undefined,
        );
        candidate = { item, connector, plan, ...(binding ? { binding } : {}) };
        valid(candidate);
        if (plan.itemId !== item.upstreamId || (item.type === 'audio') !== (plan.kind === 'audio'))
          throw new ConnectorError('invalid_response');
        // Equivalence is an explicit operator assertion, additionally checked against fresh duration.
        if (
          group &&
          !request.sourceItemId &&
          ids.length > 1 &&
          (item.runtimeSeconds == null ||
            Math.round(plan.durationMs / 1000) !== Math.round(item.runtimeSeconds))
        )
          throw new SourceSelectionError('source_changed');
        if (!best || rank[plan.mode] < rank[best.plan.mode]) {
          if (best) await dispose(best);
          best = candidate;
          candidate = undefined;
        }
      } catch (error) {
        check();
        if (!group || request.sourceItemId || error instanceof SourceSelectionError) throw error;
        // Each connector request already has a 5s deadline; at most four sequential candidates.
      } finally {
        if (candidate) await dispose(candidate);
      }
      if (best?.plan.mode === 'direct') break;
    }
    if (!best) throw new SourceSelectionError('no_compatible_source');
    valid(best);
    const selected = best;
    best = undefined;
    return selected;
  } finally {
    if (best) await dispose(best);
  }
}
