import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  Library,
  LibraryType,
  MediaItem,
  CatalogItem,
  CatalogLibrary,
  CatalogPage,
  CatalogSyncStatus,
  ConnectorErrorCode,
} from '@openflix/shared';
export function catalogId(kind: 'lib' | 'item', connectorId: string, upstreamId: string): string {
  return `${kind}_${createHash('sha256')
    .update(JSON.stringify([connectorId, upstreamId]))
    .digest('hex')}`;
}
const libraryColumns = `l.id, l.connector_id AS connectorId, c.name AS connectorName, l.upstream_id AS upstreamId,
 l.name, l.type, l.upstream_type AS upstreamType, l.last_synced_at AS lastSyncedAt`;
export class CatalogRepository {
  constructor(private readonly db: Database.Database) {}
  libraries(): CatalogLibrary[] {
    return this.db
      .prepare(
        `SELECT ${libraryColumns} FROM catalog_libraries l JOIN media_connectors c ON c.id=l.connector_id ORDER BY l.name, l.id`,
      )
      .all() as CatalogLibrary[];
  }
  library(id: string): CatalogLibrary | undefined {
    return this.db
      .prepare(
        `SELECT ${libraryColumns} FROM catalog_libraries l JOIN media_connectors c ON c.id=l.connector_id WHERE l.id=?`,
      )
      .get(id) as CatalogLibrary | undefined;
  }
  status(connectorId: string): CatalogSyncStatus {
    return (
      (this.db
        .prepare(
          `SELECT connector_id AS connectorId, state, library_id AS libraryId, started_at AS startedAt,
      finished_at AS finishedAt, last_successful_at AS lastSuccessfulAt, error FROM catalog_sync WHERE connector_id=?`,
        )
        .get(connectorId) as CatalogSyncStatus | undefined) ?? {
        connectorId,
        state: 'never',
        libraryId: null,
        startedAt: null,
        finishedAt: null,
        lastSuccessfulAt: null,
        error: null,
      }
    );
  }
  item(id: string): CatalogItem | undefined {
    const row = this.db
      .prepare(
        'SELECT metadata_json AS metadata, synced_at AS syncedAt FROM catalog_items WHERE id=?',
      )
      .get(id) as { metadata: string; syncedAt: number } | undefined;
    if (!row) return undefined;
    const libraries = this.db
      .prepare(
        'SELECT library_id AS id FROM catalog_memberships WHERE item_id=? ORDER BY library_id',
      )
      .all(id) as { id: string }[];
    return {
      ...JSON.parse(row.metadata),
      libraryIds: libraries.map((v) => v.id),
      syncedAt: row.syncedAt,
    };
  }
  browse(
    libraryId: string,
    options: { offset: number; limit: number; type?: string; parentId?: string },
  ): CatalogPage {
    const args = [
      libraryId,
      options.type ?? null,
      options.type ?? null,
      options.parentId ?? null,
      options.parentId ?? null,
    ];
    const where = `FROM catalog_items i JOIN catalog_memberships m ON m.item_id=i.id
      WHERE m.library_id=? AND (? IS NULL OR i.type=?) AND (? IS NULL OR i.parent_id=?)`;
    const rows = this.db
      .prepare(`SELECT i.id ${where} ORDER BY i.sort_title COLLATE NOCASE, i.id LIMIT ? OFFSET ?`)
      .all(...args, options.limit, options.offset) as { id: string }[];
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total ${where}`).get(...args) as {
      total: number;
    };
    return {
      items: rows.map((v) => this.item(v.id)!),
      total,
      offset: options.offset,
      limit: options.limit,
    };
  }
  private clear(runId: string): void {
    this.db.prepare('DELETE FROM catalog_stage_libraries WHERE run_id=?').run(runId);
    this.db.prepare('DELETE FROM catalog_stage_items WHERE run_id=?').run(runId);
  }
  recover(): void {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE catalog_sync SET state='failed', error='unavailable', finished_at=? WHERE state='syncing'",
          )
          .run(Date.now());
        this.db.prepare('DELETE FROM catalog_stage_libraries').run();
        this.db.prepare('DELETE FROM catalog_stage_items').run();
      })
      .immediate();
  }
  begin(connectorId: string, libraryId: string | null): string {
    const runId = randomUUID();
    this.db
      .transaction(() => {
        const old = this.db
          .prepare('SELECT run_id AS id FROM catalog_sync WHERE connector_id=?')
          .get(connectorId) as { id: string } | undefined;
        if (old) this.clear(old.id);
        this.db
          .prepare(
            `INSERT INTO catalog_sync VALUES (?, ?, 'syncing', ?, ?, NULL, NULL, NULL)
        ON CONFLICT(connector_id) DO UPDATE SET run_id=excluded.run_id, state='syncing', library_id=excluded.library_id,
        started_at=excluded.started_at, finished_at=NULL, error=NULL`,
          )
          .run(connectorId, runId, libraryId, Date.now());
      })
      .immediate();
    return runId;
  }
  stageLibrary(runId: string, library: Library): void {
    this.db
      .prepare('INSERT INTO catalog_stage_libraries VALUES (?, ?, ?)')
      .run(runId, library.id, JSON.stringify(library));
  }
  stagePage(runId: string, libraryId: string, items: readonly MediaItem[]): void {
    if (items.length > 100) throw new Error('Catalog page exceeds bound');
    this.db
      .transaction(() => {
        for (const { libraryId: itemLibrary, ...item } of items) {
          if (itemLibrary !== libraryId) throw new Error('Catalog library mismatch');
          const encoded = JSON.stringify(item);
          const old = this.db
            .prepare(
              'SELECT metadata_json AS metadata FROM catalog_stage_items WHERE run_id=? AND upstream_id=?',
            )
            .get(runId, item.id) as { metadata: string } | undefined;
          if (old && old.metadata !== encoded) throw new Error('Conflicting source item');
          this.db
            .prepare('INSERT OR IGNORE INTO catalog_stage_items VALUES (?, ?, ?)')
            .run(runId, item.id, encoded);
          // A duplicate within one library is a malformed scan, not evidence of completeness.
          this.db
            .prepare('INSERT INTO catalog_stage_memberships VALUES (?, ?, ?)')
            .run(runId, libraryId, item.id);
        }
      })
      .immediate();
  }
  fail(runId: string, code: ConnectorErrorCode): void {
    this.db
      .transaction(() => {
        this.clear(runId);
        this.db
          .prepare("UPDATE catalog_sync SET state='failed', error=?, finished_at=? WHERE run_id=?")
          .run(code, Date.now(), runId);
      })
      .immediate();
  }
  publish(runId: string): void {
    this.db
      .transaction(() => {
        const run = this.db
          .prepare(
            "SELECT connector_id AS connectorId, library_id AS libraryId FROM catalog_sync WHERE run_id=? AND state='syncing'",
          )
          .get(runId) as { connectorId: string; libraryId: string | null } | undefined;
        if (!run) throw new Error('Catalog run is no longer active');
        const now = Date.now();
        const libraries = this.db
          .prepare(
            'SELECT upstream_id AS upstreamId, metadata_json AS metadata FROM catalog_stage_libraries WHERE run_id=? ORDER BY upstream_id',
          )
          .all(runId) as { upstreamId: string; metadata: string }[];
        for (const row of libraries) {
          const lib: Library = JSON.parse(row.metadata);
          const families = this.db
            .prepare(
              `SELECT DISTINCT json_extract(i.metadata_json, '$.type') AS type FROM catalog_stage_items i
          JOIN catalog_stage_memberships m ON m.run_id=i.run_id AND m.item_id=i.upstream_id WHERE m.run_id=? AND m.library_id=?`,
            )
            .all(runId, lib.id) as { type: string }[];
          const groups = new Set(
            families.map((v) =>
              ['series', 'season', 'episode'].includes(v.type)
                ? 'television'
                : ['audio', 'album', 'artist', 'music'].includes(v.type)
                  ? 'music'
                  : v.type,
            ),
          );
          const type: LibraryType =
            groups.size > 1
              ? 'mixed'
              : groups.size === 1
                ? ([...groups][0] as LibraryType)
                : (lib.type ?? 'unknown');
          const id = catalogId('lib', run.connectorId, lib.id);
          this.db
            .prepare(
              `INSERT INTO catalog_libraries VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, upstream_type=excluded.upstream_type, last_synced_at=excluded.last_synced_at`,
            )
            .run(id, run.connectorId, lib.id, lib.name, type, lib.upstreamType ?? null, now);
          this.db.prepare('DELETE FROM catalog_memberships WHERE library_id=?').run(id);
        }
        if (run.libraryId === null)
          this.db
            .prepare(
              `DELETE FROM catalog_libraries WHERE connector_id=? AND upstream_id NOT IN
        (SELECT upstream_id FROM catalog_stage_libraries WHERE run_id=?)`,
            )
            .run(run.connectorId, runId);
        // Fetch bounded staging batches before writing: better-sqlite3 forbids writes while a cursor is active.
        let cursor = 0;
        for (;;) {
          const rows = this.db
            .prepare(
              'SELECT rowid AS cursor, metadata_json AS metadata FROM catalog_stage_items WHERE run_id=? AND rowid>? ORDER BY rowid LIMIT 100',
            )
            .all(runId, cursor) as { cursor: number; metadata: string }[];
          if (!rows.length) break;
          for (const row of rows) {
            cursor = row.cursor;
            const item: Omit<MediaItem, 'libraryId'> = JSON.parse(row.metadata);
            const ref = (value: string | undefined) =>
              value ? catalogId('item', run.connectorId, value) : undefined;
            const normalized = {
              ...item,
              id: catalogId('item', run.connectorId, item.id),
              upstreamId: item.id,
              connectorId: run.connectorId,
              parentId: ref(item.parentId),
              seriesId: ref(item.seriesId),
              seasonId: ref(item.seasonId),
              albumId: ref(item.albumId),
              artistIds: item.artistIds?.map((v) => ref(v)!),
              albumArtistIds: item.albumArtistIds?.map((v) => ref(v)!),
            };
            this.db
              .prepare(
                `INSERT INTO catalog_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET type=excluded.type, sort_title=excluded.sort_title, parent_id=excluded.parent_id,
          series_id=excluded.series_id, season_id=excluded.season_id, album_id=excluded.album_id, metadata_json=excluded.metadata_json, synced_at=excluded.synced_at`,
              )
              .run(
                normalized.id,
                run.connectorId,
                item.id,
                item.type,
                item.sortTitle ?? item.title,
                normalized.parentId ?? null,
                normalized.seriesId ?? null,
                normalized.seasonId ?? null,
                normalized.albumId ?? null,
                JSON.stringify(normalized),
                now,
              );
          }
        }
        cursor = 0;
        for (;;) {
          const rows = this.db
            .prepare(
              'SELECT rowid AS cursor, library_id AS libraryId, item_id AS itemId FROM catalog_stage_memberships WHERE run_id=? AND rowid>? ORDER BY rowid LIMIT 100',
            )
            .all(runId, cursor) as { cursor: number; libraryId: string; itemId: string }[];
          if (!rows.length) break;
          for (const row of rows) {
            cursor = row.cursor;
            this.db
              .prepare('INSERT INTO catalog_memberships VALUES (?, ?, ?)')
              .run(
                catalogId('lib', run.connectorId, row.libraryId),
                catalogId('item', run.connectorId, row.itemId),
                run.connectorId,
              );
          }
        }
        this.db
          .prepare(
            'DELETE FROM catalog_items WHERE connector_id=? AND NOT EXISTS (SELECT 1 FROM catalog_memberships m WHERE m.item_id=catalog_items.id)',
          )
          .run(run.connectorId);
        this.clear(runId);
        this.db
          .prepare(
            "UPDATE catalog_sync SET state='successful', error=NULL, finished_at=?, last_successful_at=? WHERE run_id=?",
          )
          .run(now, now, runId);
      })
      .immediate();
  }
}
