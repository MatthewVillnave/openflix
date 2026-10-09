import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CatalogItem,
  CatalogWork,
  WorkPage,
  WorkSource,
  WorkSourcePage,
} from '@openflix/shared';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Exact complete evidence equality deliberately avoids partial-ID/transitive joins. */
export function providerIdentity(
  item: Pick<CatalogItem, 'type' | 'providerIds'>,
): string | undefined {
  const values = new Map<string, string>();
  let supported = false;
  if (!['movie', 'series', 'episode'].includes(item.type)) return;
  for (const [rawKey, rawValue] of Object.entries(item.providerIds)) {
    const key = rawKey.trim().toLowerCase();
    let value = rawValue.trim();
    if (!key || !value) return;
    if (key === 'imdb') {
      if (!/^tt[0-9]{7,10}$/i.test(value)) return;
      value = value.toLowerCase();
      supported = true;
    } else if (key === 'tmdb' || key === 'tvdb') {
      if (!/^[0-9]{1,15}$/.test(value) || BigInt(value) === 0n) return;
      value = BigInt(value).toString();
      supported = true;
    }
    if (values.has(key) && values.get(key) !== value) return;
    values.set(key, value);
  }
  return supported
    ? JSON.stringify([item.type, [...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))])
    : undefined;
}
export function workIdentity(item: CatalogItem, series?: CatalogItem): string {
  let identity = providerIdentity(item);
  if (item.type === 'episode') {
    const parent = series?.type === 'series' ? providerIdentity(series) : undefined;
    if (
      !parent ||
      !item.seasonNumber ||
      !item.episodeNumber ||
      (item.episodeEndNumber != null && item.episodeEndNumber !== item.episodeNumber)
    )
      identity = undefined;
    else if (identity)
      identity = JSON.stringify([identity, parent, item.seasonNumber, item.episodeNumber]);
  }
  return 'work_' + hash(['v1', identity ?? ['source', item.id]]);
}
export function versionIdentity(item: CatalogItem): string {
  const duration = item.runtimeSeconds;
  // An explicit edition assertion and compatible duration are both necessary, never sufficient identity evidence.
  return (
    'version_' +
    hash(
      item.edition && !item.editionAmbiguous && duration != null && duration > 0
        ? ['v1', item.edition, Math.round(duration)]
        : ['source', item.id],
    )
  );
}
export class WorkRepository {
  constructor(private readonly db: Database.Database) {}
  private metadata(id: string): CatalogItem | undefined {
    const row = this.db
      .prepare('SELECT metadata_json AS metadata FROM catalog_items WHERE id=?')
      .get(id) as { metadata: string } | undefined;
    return row ? (JSON.parse(row.metadata) as CatalogItem) : undefined;
  }
  /** Called within the publication transaction; reads committed rows, never staging. */
  refresh(connectorId: string): void {
    let cursor = '';
    for (;;) {
      const rows = this.db
        .prepare(
          'SELECT id,metadata_json AS metadata FROM catalog_items WHERE connector_id=? AND id>? ORDER BY id LIMIT 100',
        )
        .all(connectorId, cursor) as { id: string; metadata: string }[];
      if (!rows.length) break;
      for (const row of rows) {
        const item = JSON.parse(row.metadata) as CatalogItem;
        const id = workIdentity(item, item.seriesId ? this.metadata(item.seriesId) : undefined);
        this.db.prepare('INSERT OR IGNORE INTO catalog_works VALUES (?,?)').run(id, item.type);
        this.db
          .prepare(
            'INSERT INTO catalog_work_members VALUES (?,?,?) ON CONFLICT(item_id) DO UPDATE SET work_id=excluded.work_id,version_key=excluded.version_key',
          )
          .run(item.id, id, versionIdentity(item));
        cursor = row.id;
      }
    }
    this.prune();
  }
  prune(): void {
    this.db
      .prepare(
        'DELETE FROM catalog_works WHERE NOT EXISTS (SELECT 1 FROM catalog_work_members m WHERE m.work_id=catalog_works.id)',
      )
      .run();
  }
  backfill(): void {
    this.db
      .transaction(() => {
        for (;;) {
          const row = this.db
            .prepare(
              'SELECT i.connector_id AS id FROM catalog_items i WHERE NOT EXISTS (SELECT 1 FROM catalog_work_members m WHERE m.item_id=i.id) LIMIT 1',
            )
            .get() as { id: string } | undefined;
          if (!row) break;
          this.refresh(row.id);
        }
        this.prune();
      })
      .immediate();
  }
  binding(itemId: string): { workId: string; versionKey: string } | undefined {
    return this.db
      .prepare(
        'SELECT work_id AS workId,version_key AS versionKey FROM catalog_work_members WHERE item_id=?',
      )
      .get(itemId) as { workId: string; versionKey: string } | undefined;
  }
  work(id: string): CatalogWork | undefined {
    const row = this.db
      .prepare(
        `SELECT w.id,w.type,
      (SELECT item_id FROM catalog_work_members WHERE work_id=w.id ORDER BY item_id LIMIT 1) AS representativeItemId,
      (SELECT COUNT(*) FROM catalog_work_members WHERE work_id=w.id) AS memberCount,
      (SELECT COUNT(DISTINCT i.connector_id) FROM catalog_work_members m JOIN catalog_items i ON i.id=m.item_id WHERE m.work_id=w.id) AS connectionCount,
      (SELECT COUNT(DISTINCT json_array(json_extract(c.server_json,'$.id'),i.upstream_id)) FROM catalog_work_members m
       JOIN catalog_items i ON i.id=m.item_id JOIN media_connectors c ON c.id=i.connector_id WHERE m.work_id=w.id) AS sourceCount
      FROM catalog_works w WHERE w.id=?`,
      )
      .get(id) as Omit<CatalogWork, 'title'> | undefined;
    if (!row) return;
    return { ...row, title: this.metadata(row.representativeItemId)!.title };
  }
  browse(options: {
    offset: number;
    limit: number;
    type?: string;
    connectorId?: string;
    seriesWorkId?: string;
    seasonNumber?: number;
  }): WorkPage {
    const clauses = ['1=1'],
      args: (string | number)[] = [];
    if (options.type) {
      clauses.push('w.type=?');
      args.push(options.type);
    }
    if (options.connectorId) {
      clauses.push(
        'EXISTS (SELECT 1 FROM catalog_work_members m JOIN catalog_items i ON i.id=m.item_id WHERE m.work_id=w.id AND i.connector_id=?)',
      );
      args.push(options.connectorId);
    }
    if (options.seriesWorkId) {
      clauses.push(`EXISTS (SELECT 1 FROM catalog_work_members m JOIN catalog_items i ON i.id=m.item_id
        JOIN catalog_work_members p ON p.item_id=i.series_id WHERE m.work_id=w.id AND p.work_id=?
        AND (?<0 OR json_extract(i.metadata_json,'$.seasonNumber')=?))`);
      args.push(options.seriesWorkId, options.seasonNumber ?? -1, options.seasonNumber ?? -1);
    }
    const where = 'FROM catalog_works w WHERE ' + clauses.join(' AND ');
    const rows = this.db
      .prepare('SELECT w.id ' + where + ' ORDER BY w.type,w.id LIMIT ? OFFSET ?')
      .all(...args, options.limit, options.offset) as { id: string }[];
    const { total } = this.db.prepare('SELECT COUNT(*) AS total ' + where).get(...args) as {
      total: number;
    };
    return {
      items: rows.map((row) => this.work(row.id)!),
      total,
      offset: options.offset,
      limit: options.limit,
    };
  }
  sources(id: string, offset = 0, limit = 50): WorkSourcePage {
    const rows = this.db
      .prepare(
        `SELECT i.id AS itemId,i.connector_id AS connectorId,c.name AS connectorName,
      i.metadata_json AS metadata,m.version_key AS versionKey FROM catalog_work_members m
      JOIN catalog_items i ON i.id=m.item_id JOIN media_connectors c ON c.id=i.connector_id
      WHERE m.work_id=? ORDER BY i.id LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset) as {
      itemId: string;
      connectorId: string;
      connectorName: string;
      metadata: string;
      versionKey: string;
    }[];
    const { total } = this.db
      .prepare('SELECT COUNT(*) AS total FROM catalog_work_members WHERE work_id=?')
      .get(id) as { total: number };
    return {
      items: rows.map(({ metadata, ...row }) => {
        const item = JSON.parse(metadata) as CatalogItem;
        return {
          ...row,
          title: item.title,
          edition: item.edition ?? null,
          versionLabels: item.versionLabels ?? [],
          versionCount: item.versionCount ?? null,
          runtimeSeconds: item.runtimeSeconds ?? null,
          availability: 'last-indexed',
        };
      }),
      offset,
      limit,
      total,
    };
  }
  versionCount(id: string): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(DISTINCT version_key) AS count FROM catalog_work_members WHERE work_id=?',
        )
        .get(id) as { count: number }
    ).count;
  }
}
