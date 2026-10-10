/** Jellyfin DTO parsing stays inside this package; only normalized metadata leaves it. */
import { z } from 'zod';
import type { MediaItem, MediaType } from '@openflix/connector-core';
const id = z.string().regex(/^[a-fA-F0-9-]{16,64}$/);
const text = z.string().max(1024);
const optionalId = id.nullish();
const count = z.number().int().min(0).max(1000000).nullish();
const pair = z.object({ Id: id, Name: text.nullish() });
export const itemSchema = z.object({
  Id: id,
  Name: text.min(1),
  Type: z.string().max(64).nullish(),
  SortName: text.nullish(),
  ProductionYear: z.number().int().min(0).max(9999).nullish(),
  PremiereDate: z.iso.datetime({ offset: true }).nullish(),
  DateCreated: z.iso.datetime({ offset: true }).nullish(),
  Etag: z.string().max(256).nullish(),
  RunTimeTicks: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullish(),
  ParentId: optionalId,
  SeriesId: optionalId,
  SeasonId: optionalId,
  AlbumId: optionalId,
  IndexNumber: count,
  IndexNumberEnd: count,
  Tags: z.array(text).max(100).nullish(),
  MediaSourceCount: z.number().int().min(0).max(100).nullish(),
  MediaSources: z
    .array(z.object({ Name: text.nullish() }))
    .max(100)
    .nullish(),
  ParentIndexNumber: count,
  Album: text.nullish(),
  ArtistItems: z.array(pair).max(100).nullish(),
  AlbumArtists: z.array(pair).max(100).nullish(),
  ProviderIds: z
    .record(z.string().max(64), z.string().max(256).nullable())
    .refine((v) => Object.keys(v).length <= 32)
    .nullish(),
});
export const pageSchema = z.object({
  Items: z.array(itemSchema).max(100),
  TotalRecordCount: z.number().int().min(0).max(1000000),
  StartIndex: z.number().int().min(0).max(1000000),
});
const types: Record<string, MediaType> = {
  Movie: 'movie',
  Series: 'series',
  Season: 'season',
  Episode: 'episode',
  Audio: 'audio',
  MusicAlbum: 'album',
  MusicArtist: 'artist',
  Playlist: 'playlist',
};
export function normalizeItem(input: unknown, libraryId = ''): MediaItem {
  const v = itemSchema.parse(input);
  const editions = [
    ...new Set(
      (v.Tags ?? [])
        .filter((tag) => tag.startsWith('OpenFlixEdition:'))
        .map((tag) => tag.slice('OpenFlixEdition:'.length).trim()),
    ),
  ];
  const edition =
    editions.length === 1 && editions[0] && editions[0].length <= 128 ? editions[0] : undefined;
  return {
    ...(edition ? { edition } : {}),
    ...(editions.length && !edition ? { editionAmbiguous: true as const } : {}),
    ...(v.MediaSourceCount != null ? { versionCount: v.MediaSourceCount } : {}),
    ...(v.MediaSources
      ? { versionLabels: v.MediaSources.flatMap((source) => (source.Name ? [source.Name] : [])) }
      : {}),
    ...(v.Type === 'Episode' && v.IndexNumberEnd != null
      ? { episodeEndNumber: v.IndexNumberEnd }
      : {}),
    id: v.Id,
    libraryId,
    title: v.Name,
    type: v.Type && Object.hasOwn(types, v.Type) ? types[v.Type]! : 'unknown',
    ...(v.Type ? { upstreamType: v.Type } : {}),
    // Only an explicitly known neutral type qualifies; unknown semantics stay conservative.
    ...(v.Type === 'Folder' ? { structural: true as const } : {}),
    ...(v.SortName != null ? { sortTitle: v.SortName } : {}),
    ...(v.ProductionYear != null ? { year: v.ProductionYear } : {}),
    ...(v.PremiereDate ? { releaseDate: v.PremiereDate } : {}),
    ...(v.DateCreated ? { createdAt: v.DateCreated } : {}),
    ...(v.Etag ? { revision: v.Etag } : {}),
    ...(v.RunTimeTicks != null ? { runtimeSeconds: v.RunTimeTicks / 10000000 } : {}),
    ...(v.ParentId ? { parentId: v.ParentId } : {}),
    ...(v.SeriesId ? { seriesId: v.SeriesId } : {}),
    ...(v.SeasonId ? { seasonId: v.SeasonId } : {}),
    ...(v.AlbumId ? { albumId: v.AlbumId } : {}),
    ...(v.Album ? { albumTitle: v.Album } : {}),
    ...(v.ArtistItems ? { artistIds: v.ArtistItems.map((a) => a.Id) } : {}),
    ...(v.AlbumArtists ? { albumArtistIds: v.AlbumArtists.map((a) => a.Id) } : {}),
    ...(v.Type === 'Season' && v.IndexNumber != null ? { seasonNumber: v.IndexNumber } : {}),
    ...(v.Type === 'Episode' && v.ParentIndexNumber != null
      ? { seasonNumber: v.ParentIndexNumber }
      : {}),
    ...(v.Type === 'Episode' && v.IndexNumber != null ? { episodeNumber: v.IndexNumber } : {}),
    providerIds: Object.fromEntries(
      Object.entries(v.ProviderIds ?? {}).filter((e): e is [string, string] => e[1] !== null),
    ),
  };
}
