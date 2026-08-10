# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

This project uses **SQLite** via the `rusqlite` crate (with `bundled` feature). There are two separate SQLite databases:

| Database | Path | Purpose |
|----------|------|---------|
| `app_state.db` | `AUDIO_APP_DB_PATH` | Domain state: playback sessions, history, media items, queue, library roots, WebDAV sources |
| `loudness_cache.db` | `LOUDNESS_DB_PATH` | Pre-computed loudness metadata cache |

Both use `Mutex<Connection>` for thread safety. There is no ORM — all queries are raw SQL.

---

## Query Patterns

### Connection ownership

```rust
// Database struct owns the connection behind a Mutex
pub struct AppDatabase {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}
```

### Standard query pattern

```rust
pub fn get_something(&self, id: i64) -> Result<Option<Record>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT col1, col2 FROM table WHERE id = ?1",
        params![id],
        |row| Ok(Record {
            col1: row.get(0)?,
            col2: row.get(1)?,
        }),
    )
    .optional()
    .map_err(|e| format!("Failed to read record: {}", e))
}
```

### List query pattern

```rust
pub fn list_somethings(&self, limit: usize) -> Result<Vec<Record>, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT col1, col2 FROM table ORDER BY id DESC LIMIT ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            Ok(Record {
                col1: row.get(0)?,
                col2: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to decode results: {}", e))
}
```

### Upsert pattern (INSERT OR REPLACE)

```rust
conn.execute(
    r#"
    INSERT INTO table (key, value, updated_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    "#,
    params![key, value, now],
)
.map_err(|e| format!("Failed to upsert: {}", e))?;
```

### Local library lightweight index contract

The backend is canonical for local media paths, cover art, and queue expansion. The frontend may hold a full lightweight index, but `source_path` must stay out of the all-track summary payload.

#### Signatures

```http
GET /domain/library/track_summaries
POST /domain/library/view
POST /domain/library/groups
GET /domain/library/tracks/{track_key}
GET /domain/library/tracks/{track_key}/cover_art
POST /domain/library/queue_from_query
POST /domain/library/queue_from_track_keys
```

```json
{
  "status": "success",
  "revision": "100:1710000000",
  "total_count": 100,
  "total_size_bytes": 123456,
  "folders": [
    { "key": "folder-hash", "label": "Albums", "path": "D:/Music/Albums", "count": 42 }
  ],
  "tracks": [
    {
      "track_key": 1,
      "media_id": "path-derived-id",
      "title": "Song",
      "artist": "Artist",
      "album": "Album",
      "file_name": "song.flac",
      "folder_key": "folder-hash",
      "folder_label": "Albums",
      "duration_secs": 180.0,
      "has_cover_art": true,
      "external_artwork_url": null,
      "size_bytes": 123456,
      "updated_at_epoch_secs": 1710000000
    }
  ]
}
```

```json
{
  "queries": ["artist", "album"],
  "folder_path": "D:/Music/Albums",
  "sort": { "field": "title", "order": "asc" },
  "range": { "start": 0, "end": 80 },
  "include_media_ids": true
}
```

```json
{
  "status": "success",
  "revision": "100:1710000000",
  "library_total_count": 100,
  "library_total_size_bytes": 123456,
  "total_count": 12,
  "total_size_bytes": 34567,
  "folders": [
    { "key": "folder-hash", "label": "Albums", "path": "D:/Music/Albums", "count": 12 }
  ],
  "rows": [
    {
      "track_key": 1,
      "media_id": "path-derived-id",
      "title": "Song",
      "artist": "Artist",
      "album": "Album",
      "file_name": "song.flac",
      "folder_key": "folder-hash",
      "folder_label": "Albums",
      "duration_secs": 180.0,
      "has_cover_art": true,
      "external_artwork_url": null,
      "size_bytes": 123456,
      "updated_at_epoch_secs": 1710000000
    }
  ],
  "media_ids": ["path-derived-id"]
}
```

```json
{
  "kind": "artists",
  "queries": ["artist", "album"],
  "folder_path": "D:/Music/Albums",
  "sort": { "field": "title", "order": "asc" },
  "selected_group_key": "Artist"
}
```

```json
{
  "status": "success",
  "revision": "100:1710000000",
  "library_total_count": 100,
  "library_total_size_bytes": 123456,
  "total_count": 12,
  "total_size_bytes": 34567,
  "folders": [
    { "key": "folder-hash", "label": "Albums", "path": "D:/Music/Albums", "count": 12 }
  ],
  "groups": [
    {
      "key": "Artist",
      "label": "Artist",
      "count": 8,
      "artwork_track_key": 1,
      "has_cover_art": true,
      "external_artwork_url": null
    }
  ],
  "selected_group_key": "Artist",
  "rows": []
}
```

Contracts:

| Case | Expected behavior |
|------|-------------------|
| Track summaries are requested | Return all lightweight track summaries and de-duplicated folder descriptors; do not serialize `source_path` in each track summary |
| Track view is requested | Filter by all normalized query tokens, then compute folder counts from the query-filtered set, then apply `folder_path`, sort, and slice `range` for visible rows |
| Track view includes `folder_path` | Match the folder itself and descendants by normalized path, not by the hashed `folder_key`; folder tree nodes use paths as selectable keys |
| Track view includes `include_media_ids=true` | Return ordered `media_ids` for the full filtered/sorted view, not only the visible page, so playback can preserve displayed order without loading full rows |
| Track view omits `range` | Return all rows for the filtered/sorted view; use this only for grouped legacy surfaces until those groups get dedicated endpoints |
| Track groups are requested | Filter by query and `folder_path`, sort rows once, return group summaries plus rows only for `selected_group_key` or the first group |
| Track groups use `kind=artists` | Split artist text on `/、，,;&`; de-duplicate a track inside each artist group |
| Track groups use `kind=albums` | Group by album text; use `__unknown_album` with `label=null` when album is empty so the frontend can localize the label |
| Track groups find empty artist text | Use `__unknown_artist` with `label=null` so the frontend can localize the label |
| Track detail is requested by `track_key` | Return the full `MediaItemRecord`, including `source_path`, or 404 if the row no longer exists |
| Cover art is requested by `track_key` | Resolve `track_key` to `media_id` server-side and reuse the existing cover-art response path |
| Queue is replaced from `track_key[]` | Expand ids to paths inside SQLite/backend, preserve submitted order, and return `{ state, queued_count }` without serializing the full queue |
| Some submitted ids no longer exist | Skip missing non-start ids; return 404 if the requested `start_track_key` is missing from the resolved set |
| Queue websocket event fires | Send a lightweight `queue_updated` event; clients decide whether to fetch the full queue or only adjacent entries |

Implementation notes:
- Use SQLite `rowid` as `track_key`; keep `media_id` path-derived for existing cover/current-track identity.
- For large `track_key[]` expansion, batch `rowid IN (...)` lookups and reorder in Rust according to the submitted ids. Do not issue one query per id.
- `LibraryTrackSummaryRecord.folder_path` may exist server-side for folder descriptors, but it must be skipped when serializing track summaries.
- Keep `/domain/library/view` rows summary-only as well; `source_path` stays behind `GET /domain/library/tracks/{track_key}`.
- Keep `/domain/library/groups` rows summary-only and selected-group scoped. The frontend must not receive all group rows just to render the left rail counts.

### Media metadata update contract

`AppDatabase::record_media_metadata_with_scan_info()` is used by both library scanning and playback events. Playback events may run after an online source already saved display metadata through `record_external_media_metadata()`, and HTTP streams often expose no embedded tags. Empty embedded metadata must not clear existing display metadata.

#### Required behavior

| Case | Expected DB behavior |
|------|----------------------|
| Incoming `title`/`artist`/`album` is `NULL` or `''` | Preserve the existing non-empty value |
| Incoming `title`/`artist`/`album` is non-empty | Update the display metadata |
| Incoming runtime fields (`duration_secs`, `sample_rate`, `channels`) are present | Update runtime fields |
| External artwork URL already exists | Preserve it unless explicitly updated by `record_external_media_metadata()` |

#### Correct pattern

```sql
UPDATE media_items
SET title = COALESCE(NULLIF(?2, ''), title),
    artist = COALESCE(NULLIF(?3, ''), artist),
    album = COALESCE(NULLIF(?4, ''), album),
    duration_secs = COALESCE(?9, duration_secs)
WHERE media_id = ?1
```

#### Required test

When changing media metadata writes, include a regression where external online metadata is saved first, then `record_media_metadata()` is called with `TrackMetadata::default()`, and the saved title/artist/album/artwork still survive.

### NCM account session contract

NCM account cookies belong to the Rust domain layer, not Solid state or `localStorage`. The frontend may capture a cookie from a login response and send it once to the account API, but every stored account returned to the UI must be a sanitized summary.

#### Signatures

```http
GET /domain/ncm/accounts
POST /domain/ncm/accounts
POST /domain/ncm/accounts/active
POST /domain/ncm/accounts/refresh
POST /domain/ncm/accounts/logout
POST /domain/ncm/accounts/daily_signin
DELETE /domain/ncm/accounts/{user_id}
```

```json
{
  "status": "success",
  "accounts": [
    {
      "user_id": 42,
      "nickname": "Ada",
      "avatar_url": "https://...",
      "has_cookie": true,
      "vip_type": 11,
      "level": 8,
      "signin_at_ms": 1710000000000,
      "added_at_ms": 1710000000000,
      "refreshed_at_ms": 1710000000000
    }
  ],
  "active_user_id": 42
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| Frontend upserts an account | Store `cookie` in `ncm_accounts`, make the account active, and return only sanitized summaries |
| Frontend lists accounts | Never serialize `cookie`; expose `has_cookie` only |
| Generic `/api/netease/*` request has no explicit cookie | Inject the active backend cookie into `Query.cookie` |
| Login probe needs no active cookie | Send `_ncm_no_active_cookie=true`; backend removes the marker and skips active cookie injection |
| Refresh active account | Optionally call `login_refresh`, then `user_account`, and update profile fields when the returned user id matches |
| Daily sign-in succeeds | Call `daily_signin` with the active backend cookie and update `signin_at_ms` |
| Active account is deleted | Clear `active_user_id` without leaving a NULL-read error |

#### Tests Required

- Migration test for `ncm_accounts` and `ncm_account_state`.
- Database test that serialized `NcmAccountRecord` does not contain `cookie`.
- Database test that deleting the active account clears active state and `active_ncm_cookie()`.
- Frontend typecheck after changing the sanitized account DTO.

#### Wrong

```typescript
window.localStorage.setItem("audio.ncm.accounts.v1", JSON.stringify({ userList }));
setActiveNcmCookie(activeAccount().cookie);
```

#### Correct

```typescript
await api.upsertNcmAccount({ userId, cookie, nickname });
const account = accountStore.activeAccount(); // { userId, nickname, hasCookie, ... }
await userAccount(); // backend injects the active cookie
```

### NCM user playlist DTO contract

User playlist list parsing belongs in Rust once the frontend only needs playlist summaries for navigation and cards. Keep raw `/user/playlist` envelopes inside `src/server/netease.rs`; frontend consumers should call the domain DTO endpoint.

#### Signature

```http
POST /domain/ncm/user/playlists
Content-Type: application/json

{
  "uid": 42,
  "limit": 100,
  "offset": 0,
  "mode": "created-playlists"
}
```

```json
{
  "status": "success",
  "playlists": [
    {
      "id": 1,
      "name": "Created",
      "creator": "Ada",
      "cover_url": "https://...",
      "track_count": 12,
      "subscribed": false
    }
  ]
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| `uid <= 0` | Return bad request; do not call NCM |
| active backend cookie exists | Inject it into `user_playlist` |
| `mode = created-playlists` | Return only summaries where `subscribed == false` |
| `mode = collected-playlists` | Return only summaries where `subscribed == true` |
| `mode` missing or unknown | Return all valid playlist summaries |
| raw item has no numeric id or string name | Drop that item from the DTO |

#### Tests Required

- Unit-test playlist summary parsing and mode filtering in `src/server/netease.rs`.
- Run frontend typecheck after changing `ApiClient.listNcmUserPlaylists()`.

### NCM track list DTO contract

Search results and playlist track lists must cross the backend/frontend boundary as stable track DTOs. Rust owns raw NCM song shapes (`ar`/`al`, legacy `artists`/`album`, `dt`/`duration`) and frontend consumers should receive ready-to-render `OnlineTrackItem` data.

#### Signatures

```http
POST /domain/ncm/search/tracks
POST /domain/ncm/search/playlists
Content-Type: application/json

{
  "keywords": "search text",
  "limit": 30,
  "offset": 0
}
```

```http
POST /domain/ncm/playlist/tracks
Content-Type: application/json

{
  "id": 123,
  "limit": 200,
  "offset": 0
}
```

```http
POST /domain/ncm/recommend/songs/tracks
POST /domain/ncm/song/details/tracks
POST /domain/ncm/personal_fm/tracks
POST /domain/ncm/album/tracks
POST /domain/ncm/artist/tracks
POST /domain/ncm/user/likelist
```

```json
{
  "status": "success",
  "tracks": [
    {
      "id": "ncm-song-42",
      "song_id": 42,
      "source_path": "https://music.163.com/#/song?id=42",
      "title": "Needle",
      "artist": "A, B",
      "album": "Album",
      "duration_secs": 180.0,
      "artwork_url": "https://..."
    }
  ]
}
```

```json
{
  "status": "success",
  "playlists": [
    {
      "id": 1,
      "name": "Playlist",
      "creator": "Ada",
      "cover_url": "https://...",
      "track_count": 12,
      "subscribed": false
    }
  ]
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| search `keywords` is blank | Return bad request; do not call NCM |
| playlist `id <= 0` | Return bad request; do not call NCM |
| album/artist `id <= 0` | Return bad request; do not call NCM |
| song detail `ids` contains invalid IDs | Drop non-positive IDs; if none remain, return bad request |
| likelist `uid <= 0` | Return bad request; do not call NCM |
| active backend cookie exists | Inject it into track-list and likelist requests |
| raw song has `ar`/`al`/`dt` fields | Map artists, album, cover, and milliseconds to seconds |
| raw song has legacy `artists`/`album`/`duration` fields | Map them to the same DTO fields |
| raw songs are under `data.dailySongs`, `data`, `songs`, or `hotSongs` | Use the endpoint-specific root and return the same `tracks` DTO |
| raw song has no numeric id or string name | Drop that item from the DTO |
| search playlist response uses `result.playlists` | Return sanitized playlist summaries and drop malformed rows |
| likelist raw response uses `data.ids` or root `ids` | Return `{ status: "success", ids: number[] }` |
| frontend receives search playlists | `DiscoverMode.tsx` calls `ApiClient.searchNcmPlaylists()`; `ncmPlaylistSummary.ts` remains type-only |

#### Tests Required

- Unit-test search track parsing for modern fields.
- Unit-test search playlist parsing for sanitized summaries.
- Unit-test playlist track parsing for legacy fields.
- Unit-test daily/personal FM/artist roots and likelist ID parsing.
- Run frontend typecheck after changing search or track-list client methods.

### NCM home feed DTO contract

The recommend home page must not parse raw `/personalized`, `/recommend/resource`, `/playlist/detail`, `/album/newest`, `/top/artists`, `/personalized/mv`, or `/personalized/djprogram` envelopes in Solid components. Rust owns these upstream shapes and returns one stable home feed DTO.

#### Signature

```http
POST /domain/ncm/home_feed
Content-Type: application/json

{
  "user_id": 42
}
```

```json
{
  "status": "success",
  "feed": {
    "daily_picks": [
      {
        "id": 1,
        "title": "Playlist",
        "subtitle": "Ada",
        "cover_url": "https://...",
        "play_count": 1234,
        "description": "copy"
      }
    ],
    "daily_song_covers": [{ "id": 11, "url": "https://..." }],
    "liked_song_covers": [{ "id": 12, "url": "https://..." }],
    "personal_fm_covers": [{ "id": 13, "url": "https://..." }],
    "personal_fm_preview": {
      "title": "Song",
      "artist": "Artist",
      "album": "Album",
      "cover_url": "https://..."
    },
    "radar_playlists": [],
    "recommended_playlists": [],
    "new_albums": [],
    "featured_artists": [],
    "recommended_mvs": [],
    "podcasts": [],
    "errors": []
  }
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| `user_id <= 0` | Return bad request |
| `user_id` is missing or no active cookie exists | Skip account-only sections and still return public sections |
| Active backend cookie exists | Inject it into NCM requests without exposing it to the frontend |
| One upstream section fails | Log a warning, append `{ section, message }` to `errors`, and keep returning other sections |
| Radar playlists | Resolve the fixed radar playlist IDs in Rust and drop failed/malformed items |
| Personal FM | Call `/personal_fm` once, derive both cover preview and title/artist/album preview from the same tracks |
| Frontend receives `feed` | Render DTO arrays only; do not import raw `shared/api/ncm` calls or raw response parsers in `NeteaseHomeFeed.tsx` |

#### Tests Required

- Unit-test home feed card parsing for playlist, resource, album, artist, MV, DJ, and radar shapes.
- Run `cargo test --lib`, frontend typecheck, and frontend build after changing the endpoint or `ApiClient.getNcmHomeFeed()`.

### NCM discover browse DTO contract

The Discover browse tabs must not parse raw `/top/playlist`, `/top/playlist/highquality`, `/toplist/detail`, `/artist/list`, `/album/new`, `/top/song`, `/playlist/catlist`, or `/playlist/highquality/tags` envelopes in Solid components. Rust owns the upstream response shapes and exposes stable browse DTOs.

#### Signatures

```http
POST /domain/ncm/discover/playlists
POST /domain/ncm/discover/albums
POST /domain/ncm/discover/artists
POST /domain/ncm/discover/toplists
POST /domain/ncm/discover/songs
POST /domain/ncm/discover/playlist_categories
```

```json
{
  "status": "success",
  "items": [
    {
      "id": 1,
      "title": "Playlist",
      "subtitle": "Ada",
      "cover_url": "https://...",
      "cursor": 1710000000000
    }
  ],
  "has_more": true
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| Playlist `kind` is not `normal` or `hq` | Return bad request |
| High-quality playlist pagination | Accept `before` as the previous card `cursor` (`updateTime`), matching NCM/SPlayer semantics |
| Albums endpoint returns `total` | Compute `has_more` from `offset + limit < total`; otherwise fall back to upstream `more` or item count |
| Top song type is outside `0, 7, 96, 16, 8` | Return bad request |
| Playlist category tags fail but normal categories succeed | Log a warning, return categories with empty `hq_names` |
| Frontend receives browse data | Render DTO fields only; do not import raw discover parsers in `DiscoverMode.tsx` |

#### Tests Required

- Unit-test discover card parsing for playlist, album, artist, toplist, category, and top song wrapper shapes.
- Run `cargo test --lib`, frontend typecheck, and frontend build after changing the endpoint or discover client methods.

### NCM online track resolve/playback contract

NCM online playback resolution belongs in the Rust domain API once the frontend already has a song id. The frontend may provide UI-derived fallback metadata, but Rust must own active-cookie injection, the URL/detail fan-out, and `record_external_media_metadata()` write.

#### Signatures

```http
POST /domain/ncm/track/resolve
Content-Type: application/json

{
  "song_id": 123,
  "level": "exhigh",
  "source_page_url": "https://music.163.com/#/song?id=123",
  "title": "fallback title",
  "artist": "fallback artist",
  "album": "fallback album",
  "duration_secs": 180.0,
  "artwork_url": "https://..."
}
```

```json
{
  "status": "success",
  "track": {
    "song_id": 123,
    "stream_url": "https://...",
    "source_page_url": "https://music.163.com/#/song?id=123",
    "title": "resolved title",
    "artist": "resolved artist",
    "album": "resolved album",
    "cover_url": "https://...",
    "duration_secs": 180.0
  }
}
```

```http
POST /domain/ncm/track/play
POST /domain/ncm/track/enqueue
Content-Type: application/json

<same request body as /domain/ncm/track/resolve>
```

```json
{
  "status": "success",
  "track": { "...": "ResolvedNcmTrack" },
  "state": { "...": "StateResponse" }
}
```

```json
{
  "status": "success",
  "track": { "...": "ResolvedNcmTrack" },
  "queue": [{ "...": "QueueEntryRecord" }]
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| `song_id <= 0` | Return a bad request; do not call NCM or write metadata |
| `level` is missing or blank | Use `"exhigh"` |
| `cookie` is present | Copy it into both `song_url_v1` and `song_detail` `Query.cookie`; never log it |
| `cookie` is missing | Fall back to the active backend NCM account cookie |
| URL response contains `data[0].url` | Validate it with `validate_path()` before returning or persisting |
| Detail response is available | Prefer NCM title/artist/album/cover over frontend fallback fields |
| Detail response fails | Log a warning and continue with fallback metadata; playback depends only on a valid stream URL |
| Metadata write fails | Log a warning and still return the resolved track |
| `/domain/ncm/track/play` succeeds | Resolve first, persist metadata/source mapping, then call the playback helper that owns player load, session replacement, history append, queue snapshot sync, and NCM scrobble session setup; return both `track` and `state` |
| `/domain/ncm/track/enqueue` succeeds | Resolve first, persist metadata/source mapping, append the validated `stream_url` to the active persistent queue, emit queue update, and return both `track` and `queue` |
| Resolve fails in play/enqueue | Do not load the player or append to the queue |
| Frontend starts or queues an NCM track | Call `ApiClient.playNcmTrack()` or `ApiClient.enqueueNcmTrack()`; do not chain `resolveNcmTrack()` with `/load` or `/domain/queue/enqueue` |

#### Good/Base/Bad Cases

- Good: authenticated request resolves the stream URL, supplements display metadata from `song_detail`, writes external metadata, and returns the `track` object.
- Good: online play calls `/domain/ncm/track/play`; Rust atomically resolves, records metadata/source mapping, replaces the active playback session, starts backend scrobble tracking, and returns the new player state.
- Good: online enqueue calls `/domain/ncm/track/enqueue`; Rust atomically resolves and appends the resulting stream URL to the persistent queue.
- Base: unauthenticated public song resolves with fallback title/artist/album from the frontend.
- Bad: missing or rejected stream URL returns an error and must not enqueue or load the source.

#### Tests Required

- Unit-test `song_url_v1` body parsing for `data[0].url`.
- Unit-test `song_detail` parsing for modern `ar`/`al` fields and legacy `artists`/`album` fields.
- Run `cargo check`, `cargo test --lib`, frontend typecheck, and frontend build after changing the endpoint or `ApiClient` contract.

#### Wrong

```typescript
const [url, detail] = await Promise.all([songUrlV1(...), songDetail(...)]);
await api.saveExternalMediaMetadata(...);
```

```typescript
const track = await api.resolveNcmTrack(input);
await api.load(track.streamUrl, { autoplay: true });
await api.enqueueTrack(track.streamUrl);
```

#### Correct

```typescript
const track = await api.resolveNcmTrack({ songId, level, ...fallbacks });
onRegisterPlayback(track);
```

```typescript
const { track, state } = await api.playNcmTrack({ songId, level, ...fallbacks });
onRegisterPlayback(track);
```

### NCM scrobble tracking contract

NCM listen reporting belongs to the Rust playback layer because the backend owns the real player state, persistent playback sessions, and active account cookie. The frontend must not run a wall-clock component hook that calls `/scrobble`.

#### Data flow

```text
/domain/ncm/track/resolve -> ncm_track_sources -> playback session lifecycle -> ncm_client.scrobble()
```

#### Signatures

```rust
AppDatabase::record_ncm_track_source(source_path, song_id, source_page_url)
AppDatabase::ncm_track_source_for_path(source_path)
AppDatabase::mark_ncm_track_scrobbled(source_path, scrobble_secs)
```

```rust
begin_ncm_scrobble_session(data, session_id, source_path, is_playing)
start_ncm_scrobble_segment(data, session_id)
stop_ncm_scrobble_segment(data, session_id)
finish_ncm_scrobble_session(data, session_id, reason)
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| NCM track resolves successfully | Persist `stream_url` to `song_id` in `ncm_track_sources` after `record_external_media_metadata()` |
| `/load` or queue play starts a mapped NCM stream | Start an in-memory scrobble session keyed by `playback_sessions.session_id` |
| Player is playing and not loading | Accumulate elapsed `Instant` time only while the session is in an audible playing segment |
| Player pauses | Stop the active segment without resetting accumulated time |
| Session is replaced, stopped, or naturally ended | Finish the scrobble session and submit only when accumulated time is at least 30 seconds |
| No active backend NCM cookie exists | Skip the submit without surfacing a playback error |
| Submit succeeds | Mark `ncm_track_sources.scrobbled_at` and `scrobble_secs` for the stream |
| Frontend needs listen reporting | It should do nothing; Rust owns `/scrobble` calls |

#### Good/Base/Bad Cases

- Good: `/domain/ncm/track/resolve` records `stream_url -> song_id`, `/load` starts a mapped playback session, the playback supervisor accumulates only when `PlayerState::Playing && !is_loading`, and `finish_ncm_scrobble_session(..., "ended")` submits after at least 30 seconds.
- Base: a local/WebDAV track has no `ncm_track_sources` row; scrobble setup returns early and playback continues normally.
- Bad: a Solid effect imports `scrobble()` and submits on component cleanup or page refresh; this can double-report or lose listens and must be removed.

#### Tests Required

- Migration test for `ncm_track_sources` with `song_id`, `scrobbled_at`, and `scrobble_secs`.
- Database test that resolving a stream can be read back by path and marked scrobbled.
- `cargo test --lib` after changing playback session finish semantics.
- Frontend typecheck after removing or changing any scrobble UI bridge.

#### Wrong

```typescript
void scrobble({ id: songId, sourceid: "", time: seconds }).catch(() => {});
```

#### Correct

```rust
finish_ncm_scrobble_session(data, session_id, "ended");
```

### NCM current-track supplement contract

After a stream URL has been resolved, current-track enrichment should not fan out from the frontend to `/song/detail` and `/lyric/new` separately. Keep the NCM request/cookie boundary in Rust and return one supplement DTO for the active track. Rust owns raw NCM lyric parsing and returns normalized lyric lines that the frontend can render directly.

#### Signatures

```http
POST /domain/ncm/track/supplement
Content-Type: application/json

{
  "song_id": 123,
  "cookie": "MUSIC_U=..."
}
```

```json
{
  "status": "success",
  "supplement": {
    "song_id": 123,
    "title": "resolved title",
    "artist": "resolved artist",
    "album": "resolved album",
    "cover_url": "https://...",
    "lyrics": [
      {
        "time": 1.0,
        "end_time": 2.5,
        "text": "line text",
        "translated": "translated line",
        "roman": null,
        "words": [
          { "start_time": 1.0, "end_time": 1.4, "text": "line" }
        ]
      }
    ],
    "detail_error": null,
    "lyrics_error": null
  }
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| `song_id <= 0` | Return a bad request; do not call NCM |
| `cookie` is present | Copy it into both `song_detail` and `lyric_new` `Query.cookie`; never log it |
| `cookie` is missing | Fall back to the active backend NCM account cookie |
| Detail succeeds and lyric fails | Return detail fields, `lyrics: []`, and `lyrics_error` |
| Lyric succeeds and detail fails | Return parsed `lyrics`, null detail fields, and `detail_error` |
| Both fail | Return success with both error fields so frontend can still use local lyrics fallback |
| Frontend receives `lyrics` | Treat it as an already-normalized DTO; do not parse raw LRC/YRC/QRC/TTML in the frontend |
| Local sidecar lyrics exist | `/domain/current_lyrics` returns the same normalized `lyrics` array plus `source`; no raw sidecar text crosses the API boundary |

#### Good/Base/Bad Cases

- Good: online detail and lyric payload both resolve and feed current full-player metadata.
- Base: online lyric fails, local sidecar lyric still renders from `/domain/current_lyrics`.
- Bad: frontend directly calls `songDetail()` and `lyricNew()` for the current playing track, duplicating cookie and partial-failure policy.

#### Tests Required

- Run `cargo test --lib` after changing the Rust fan-out endpoint.
- Run frontend typecheck after changing `ApiClient.resolveNcmTrackSupplement()`.
- Keep the frontend response parser strict for snake_case lyric fields and nullable error fields.

### Media identity API contract

Backend and frontend routes must not put raw media IDs derived from filesystem paths into path segments. `media_id_for_path()` intentionally returns normalized paths such as `d:/music/artist/track.flac`; encoded slashes may be decoded by HTTP routing before route matching, producing false 404s.

#### Signatures

```http
GET /domain/media_items/cover_art?media_id=<media_id>&token=<token>
POST /domain/queue/play
Content-Type: application/json

{ "entry_id": 123, "source_path": "D:\\Music\\Track.flac" }
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| Cover art lookup | Pass `media_id` as a query parameter, not `/domain/media_items/{media_id}/...` |
| Cover art identity input | Accept canonical `media_id` values, raw paths, backslash extended Windows paths (`\\?\D:\...`), and forward-slash extended Windows paths (`//?/D:/...`) by normalizing with `media_id_for_path()` at lookup boundaries |
| Cover art exists in DB cache | Return cached bytes with the stored MIME type |
| Cover art missing from DB but requested media is current track | Return the current runtime decoder cover art as a fallback |
| Cover art missing from DB but media item points at a local file | Lazily extract local metadata through the shared Symphonia → lofty → sidecar-art path, write it back through `record_media_metadata()`, then return it |
| `track_changed` WebSocket event | Include `media_id`, display metadata, `has_cover_art`, and `external_artwork_url` for the new track; consumers must not inherit cover flags from the previous track |
| Library queue `start_media_id` lookup | Compare the requested id to resolved queue rows through `media_id_for_path()`; never use raw string equality for path-derived ids |
| Queue play with `entry_id` and `source_path` | Require one entry where both match; a stale id must not fall back to another row with the same normalized path |
| Queue play with only `entry_id` | Match the entry id exactly |
| Queue play with only `source_path` | Match by normalized media identity |
| No queue entry matches | Return 404 with `Queue entry not found` |

#### Wrong

```typescript
api.playFromQueue(entry.entry_id);
`${baseUrl}/domain/media_items/${encodeURIComponent(mediaId)}/cover_art`;
```

#### Correct

```typescript
api.playFromQueue({ entryId: entry.entry_id, sourcePath: entry.source_path });
const params = new URLSearchParams({ media_id: mediaId });
`${baseUrl}/domain/media_items/cover_art?${params.toString()}`;
```

#### Tests required

- Unit-test path identity normalization (`D:\...`, `\\?\D:\...`, `//?/D:/...`, and `//?/UNC/...` refer to the same media where appropriate).
- Unit-test library queue `start_media_id` matching with a forward-slash extended Windows path so filtered/resolved views do not reject the requested start track.
- Unit-test cover-art lookup with both normalized `media_id` and raw/extended Windows path input.
- Keep local scan, lazy cover-art lookup, and runtime metadata persistence on the same local metadata reader. Do not make `/cover_art` depend only on lofty while playback uses Symphonia visuals.
- Build the frontend after changing `ApiClient` request shapes.

### Queue adjacent playback contract

Queue previous/next decisions belong to Rust because the backend owns queue status, shuffle order, media identity normalization, and the currently loaded player path. Frontend controls should trigger commands and render backend-provided adjacent availability instead of computing neighbors from a local queue array.

#### Signatures

```http
GET /domain/queue/adjacent
POST /domain/queue/play_previous
POST /domain/queue/play_next
```

```json
{
  "status": "success",
  "previous_entry_id": 1,
  "next_entry_id": 3
}
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| Current path is `NULL` | Adjacent IDs are `null`; play previous/next returns 404 |
| Current path uses raw or extended Windows syntax | Normalize with `media_id_for_path()` before matching queue entries |
| Shuffle is enabled | Previous/next use `COALESCE(shuffle_index, position_index)` order |
| Next entry is `queued` or `preloading` | `/domain/queue/play_next` loads it through `load_queue_entry_for_playback()` |
| Previous entry is already `played` | `/domain/queue/play_previous` can load it; manual previous should not require `queued` status |
| No adjacent entry exists | Return 404 with an API error envelope; frontend shows the command error without trying a fallback |

#### Tests Required

- Unit-test `peek_previous_queue_entry()` against shuffle order and normalized paths.
- Run `cargo test --lib` after changing queue cursor helpers.
- Run frontend typecheck/build after changing `ApiClient` queue command contracts.

### Persistent queue source identity contract

#### 1. Scope / Trigger

Use this contract whenever queue persistence, navigation, gapless preload, or
remote source resolution changes. A queue row is both playback order and durable
source authority; `source_path` alone is not a unique or secure identity.

#### 2. Signatures

```sql
ALTER TABLE playback_queue_entries
    ADD COLUMN source_key TEXT
    REFERENCES webdav_sources(source_key) ON DELETE SET NULL;

ALTER TABLE playback_queue_entries
    ADD COLUMN source_identity TEXT NOT NULL DEFAULT 'infer'
    CHECK (source_identity IN ('infer', 'public', 'webdav'));
```

```rust
pub struct QueueEntryInput {
    pub source_path: String,
    pub source_key: Option<String>,
    pub infer_source_key: bool,
}

pub fn replace_queue_entries_with_sources(
    &self,
    queue_id: &str,
    entries: &[QueueEntryInput],
) -> Result<(), String>;

pub fn mark_queue_entry_status(
    &self,
    queue_id: &str,
    entry_id: i64,
    status: &str,
) -> Result<(), String>;
```

Request DTOs may carry `{ path, source_key }`; `/queue_next` may additionally
carry `entry_id`. They never carry a username or password.

#### 3. Contracts

| Boundary | Contract |
|----------|----------|
| `QueueEntryInput::public(path)` | Persist `source_identity = 'public'`, `source_key = NULL`; later membership changes cannot grant credentials |
| `QueueEntryInput::with_source_key(path, key)` | Require an existing WebDAV source and persist `source_identity = 'webdav'` with that exact key |
| `QueueEntryInput::new(path)` | Resolve an unambiguous membership at write time when possible; otherwise persist `source_identity = 'infer'` for legacy-compatible playback resolution |
| Migration 13 legacy row | Keep `source_key = NULL` and `source_identity = 'infer'`; do not rewrite historical URLs to the current default source |
| Source deletion | `ON DELETE SET NULL` clears the key; the remaining `webdav` identity fails closed instead of changing authority |
| Queue cursor/navigation/status | Use `entry_id`, not path; duplicate URLs and normalized path aliases remain distinct ordered entries |
| Preload publication/cleanup | Carry `entry_id` with path and generation so an old failure cannot clear or promote a newer row sharing the same URL |

#### 4. Validation & Error Matrix

| Case | Expected behavior |
|------|-------------------|
| Explicit source key does not exist | Reject the queue write |
| Multiple WebDAV memberships and no explicit key | Keep infer authority at persistence; playback resolver rejects ambiguity |
| `source_identity = 'webdav'` and `source_key IS NULL` | Playback/preload returns an error; no default fallback |
| `entry_id` matches but supplied path does not | Return queue entry not found |
| Two rows share one path | Navigation and status updates affect only the selected `entry_id` |
| Old preload fails after a newer preload starts | Clear pending state only when generation, path, and entry id still match |

#### 5. Good/Base/Bad Cases

- Good: two configured sources share a URL; persisted rows restart with their
  original keys and each decoder receives only that source's credentials.
- Base: a local or public row has no source key and continues to work through
  public-only access.
- Bad: update every row matching `source_path`, choose the default WebDAV source,
  or let a stale preload clear a newer row with the same URL.

#### 6. Tests Required

- Migration 13 fresh/idempotent/legacy tests assert both columns, index,
  nullable rows, foreign-key behavior, and schema version 13.
- Queue persistence tests restart the database with multiple WebDAV sources and
  assert `source_key` plus `source_identity` round-trip.
- Duplicate-URL tests assert exact next/previous cursor movement, one-row status
  updates, strict queue-play entry-id matching, and preload generation ownership.
- Run focused migration/source/queue tests and `cargo test --locked`.

#### 7. Wrong vs Correct

#### Wrong

```rust
db.mark_queue_entry_status_by_path("active", path, "played")?;
let credentials = default_webdav_config.http_credentials();
```

#### Correct

```rust
db.mark_queue_entry_status("active", entry.entry_id, "played")?;
let resolved = resolve_queue_media_source(&db, &entry)?;
player.queue_next_with_source_access(
    &resolved.path,
    &resolved.access,
    Some(entry.entry_id),
)?;
```

### Transaction pattern

```rust
pub fn batch_operation(&self, items: &[Item]) -> Result<(), String> {
    let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    for item in items {
        tx.execute("INSERT INTO ...", params![...])
            .map_err(|e| format!("Failed to insert: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    Ok(())
}
```

### Boolean handling

SQLite stores booleans as integers. Use the `bool_to_sqlite` helper:

```rust
fn bool_to_sqlite(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

// Reading: compare against 0
is_default: row.get::<_, i64>(4)? != 0,
```

### Timestamp handling

All timestamps are stored as `INTEGER` (Unix epoch seconds). Use `now_epoch_secs_i64()`:

```rust
fn now_epoch_secs_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}
```

### Playback history invalidation contract

Playback history is read through HTTP but invalidated through WebSocket. Any backend path that successfully inserts a `playback_history` row must emit the playback-history event so mounted UI pages can refresh without guessing from generic playback events.

#### Signatures

```rust
fn append_playback_history_and_emit(
    data: &web::Data<Arc<AppState>>,
    shared: &Arc<SharedState>,
    session_id: Option<i64>,
    source_path: &str,
    event_type: &str,
    position_secs: Option<f64>,
    payload: Option<&serde_json::Value>,
) -> Result<(), String>
```

```json
{ "type": "playback_history_updated", "timestamp": 1710000000000 }
```

#### Contracts

| Case | Expected behavior |
|------|-------------------|
| `/load` or queue play starts a new track | Start/replace the playback session, insert `load_requested`, then emit `playback_history_updated` |
| Natural end advances to the next queued track | Finish the old session as `ended`, insert `playback_ended`, then start the next session and insert its `load_requested` |
| `/play`, `/pause`, `/stop`, `/seek`, natural end, or queue-next records an event | Insert the matching history row through `append_playback_history_and_emit()` |
| History insert fails | Log or return the insert error; do not emit `playback_history_updated` |
| Frontend receives `playback_history_updated` | Increment a local refresh version and let `HistoryPage` refetch `/domain/playback_history` |
| Frontend receives `play`, `pause`, `track_changed`, `load_complete`, or other playback events | Update player UI only; do not infer that playback history changed |

#### Wrong

```typescript
case "play":
  refreshRecentlyPlayed();
  break;
```

#### Correct

```typescript
case "playback_history_updated":
  bumpPlaybackHistoryVersion();
  break;
```

#### Tests required

- `cargo check --bin audio_server` after changing event constants or playback handlers.
- Frontend `typecheck` after changing `WsEvent` payloads.
- Manual or integration coverage should verify direct load and queue play both create recent-playback rows and refresh an already-open History page.

---

### Local playlist persistence contract

Local playlists for the Library page belong in `app_state.db`, not browser storage. The frontend may render SPlayer-like playlist controls, but playlist membership, ordering, and media deletion cascade must be owned by Rust/SQLite so rescans and app restarts preserve state.

#### 1. Scope / Trigger

- Trigger: adding or changing local playlist behavior in the Library page.
- Applies when a feature touches `local_playlists`, `local_playlist_items`, `/domain/local_playlists*`, or `ApiClient` local playlist methods.

#### 2. Signatures

```http
GET /domain/local_playlists
POST /domain/local_playlists
GET /domain/local_playlists/{playlist_id}
PATCH /domain/local_playlists/{playlist_id}
DELETE /domain/local_playlists/{playlist_id}
POST /domain/local_playlists/{playlist_id}/items
POST /domain/local_playlists/{playlist_id}/items/remove
POST /domain/local_playlists/{playlist_id}/queue
POST /domain/media_items/delete
```

```sql
local_playlists(playlist_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, cover_media_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
local_playlist_items(playlist_id TEXT NOT NULL, media_id TEXT NOT NULL, position_index INTEGER NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY(playlist_id, media_id))
```

#### 3. Contracts

| Operation | Expected behavior |
|-----------|-------------------|
| List playlists | Return summaries sorted by `updated_at DESC`, with `track_count` and first-cover fallback fields |
| Create playlist | Trim `name`, reject empty names, store optional trimmed non-empty description |
| Add media | Deduplicate request IDs, ignore IDs already in the playlist, prepend newly-added existing media, and shift old `position_index` values |
| Remove media | Delete requested memberships, then reindex remaining items from `0` |
| Delete media items | Delete from `media_items`; playlist membership must cascade through FK |
| Fetch detail | Return playlist summary plus `MediaItemRecord[]` ordered by playlist `position_index` |
| Play playlist | Expand queue on the backend from `local_playlist_items`, ordered by `position_index`; request body carries only optional `start_media_id` |

#### 4. Validation & Error Matrix

| Case | Expected behavior |
|------|-------------------|
| Empty `media_ids` request | HTTP 400 |
| Missing playlist | HTTP 404 for playlist detail/delete/add/remove |
| Missing playlist queue source | HTTP 404 for playlist queue playback |
| Unknown media id in add request | Skip it without failing the whole request |
| Duplicate media id in add/remove request | Count it once |
| Deleting media that belongs to playlists | Membership disappears by `ON DELETE CASCADE` |
| `start_media_id` absent from playlist queue source | HTTP 404 with `Start track is not in the local playlist` |

#### 5. Good/Base/Bad Cases

- Good: Library UI calls `ApiClient.addMediaToLocalPlaylist()` and refreshes playlist summaries/detail after success.
- Good: Library UI starts playlist playback with `ApiClient.replaceQueueFromLocalPlaylist({ playlistId, startMediaId })`; it does not submit the rendered row list as the queue source.
- Base: Creating an empty playlist stores a summary with `track_count = 0`.
- Bad: storing local playlists in Solid state, `localStorage`, or localforage creates a second source of truth and will drift from rescans/deletes.
- Bad: `replaceQueueFromTrackKeys({ trackKeys: currentlyRenderedRows.map(...) })` for playlist playback couples queue expansion to virtualization/filter UI state.

#### 6. Tests Required

- Migration test creates `local_playlists`, `local_playlist_items`, and indexes.
- Database test covers create, prepend add, remove/reindex, and cascade after `delete_media_items()`.
- Database test covers local playlist queue source order and missing playlist behavior.
- Frontend API test covers `replaceQueueFromLocalPlaylist()` path/body.
- Frontend `typecheck` after changing `LocalPlaylist` DTO fields or API response parsers.

#### 7. Wrong vs Correct

#### Wrong

```typescript
window.localStorage.setItem("local-playlists", JSON.stringify(playlists));
```

#### Correct

```typescript
await api.addMediaToLocalPlaylist(playlistId, selectedItems.map((item) => item.media_id));
await api.getLocalPlaylist(playlistId);
```

---

## Migrations

### Local library root membership and cleanup contract

#### 1. Scope / Trigger

Use this contract for local-library scans, library-root deletion, media deletion, and any
`app_state.db` migration that changes which media belongs to the offline library. A row in
`media_items` is global metadata; it is not a local-library member unless it has a row in
`library_root_memberships`.

#### 2. Signatures

```rust
pub(crate) fn open_with_webdav_fallback<P: AsRef<Path>>(
    path: P,
    webdav_fallback_base_url: Option<&str>,
) -> Result<AppDatabase, String>;
pub fn begin_library_scan_seen_set(&self, scan_task_id: u64) -> Result<(), String>;
pub fn mark_library_scan_seen_media_ids(
    &self,
    scan_task_id: u64,
    media_ids: &[String],
) -> Result<(), String>;
pub fn finalize_library_root_scan(
    &self,
    root_id: i64,
    scan_task_id: u64,
    finished_at: u64,
) -> Result<LibraryScanFinalizeRecord, String>;
pub fn finalize_partial_library_root_scan(
    &self,
    root_id: i64,
    scan_task_id: u64,
    finished_at: u64,
) -> Result<LibraryScanFinalizeRecord, String>;
pub fn delete_library_root(
    &self,
    root_id: i64,
) -> Result<Option<LibraryRootDeleteRecord>, String>;
pub(super) fn reconcile_runtime_after_library_cleanup(
    data: &web::Data<Arc<AppState>>,
    cleanup: &LibraryCleanupReport,
);
```

```sql
CREATE TABLE library_root_memberships (
    root_id    INTEGER NOT NULL,
    media_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (root_id, media_id),
    FOREIGN KEY(root_id) REFERENCES library_roots(root_id) ON DELETE CASCADE,
    FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
);
```

#### 3. Contracts

| Boundary | Contract |
|----------|----------|
| Library reads | `library_summary_stats`, summaries, groups, folders, detail, cover-art track lookup, and queue expansion require `EXISTS` membership; global media/history APIs remain unfiltered. |
| Local root | Match `source_kind = 'local'` with normalized Windows path identities and a segment boundary. `D:/Music2` is not under `D:/Music`; ordinary, `\\?\`, `//?/`, and UNC variants share one identity. |
| WebDAV root | Match `source_kind = 'remote'` by URL scheme/host/port and path-segment boundary; exclude rows with an `ncm_track_sources` mapping. A legacy root with `source_key IS NULL` uses the persisted default WebDAV source, then the runtime fallback base URL supplied to database open; an explicit missing key must not silently fall back to another source. |
| Complete scan commit | The temporary seen set stores the database's final `media_id`, not an ID recomputed from a path. A fully successful scan atomically inserts seen memberships, removes unseen memberships, cleans media that lost its last membership, updates root status/count, and clears the temporary set. |
| Partial scan commit | A traversal bound or conservative path collision inserts/refreshes seen memberships, retains every unseen committed membership, performs zero media cleanup, sets the root status to `partial`, counts all retained members, and clears the temporary set in the same transaction. |
| Scan failure | Browse, cancellation, write, or metadata-refresh failures must not replace committed memberships. When a previously committed file cannot be decoded during a refresh, retain its stored `media_id` in the seen set for that scan. |
| Complete cleanup | Delete analysis tasks, history, sessions, queue entries/state, playlist items/covers, NCM mappings, cover cache, memberships, and finally the actual `media_items.media_id` in one SQLite transaction. Reindex affected queues/playlists. |
| Runtime invalidation | A successful runtime cleanup returns the removed source paths and session IDs as non-serialized process-local invalidation data. Cancel a matching pending preload, detach a matching current queue cursor, discard removed active/scrobble session IDs, persist the reconciled shared queue snapshot, then emit queue/history events. A loaded track may keep playing from its existing buffer; a matching in-flight load must be stopped so it cannot republish the deleted identity. |
| Disk safety | Migration, root deletion, scan finalization, and database media deletion never call an audio-file delete API. File deletion is a separate, explicit, validated endpoint. |
| HTTP result | Root/media deletion responses preserve the existing media count and may expose `removed_analysis_task_count`, `removed_history_count`, `removed_session_count`, `removed_queue_entry_count`, `cleared_queue_state_count`, playlist, cover, and NCM cleanup counts. |

#### 4. Validation & Error Matrix

| Case | Expected behavior |
|------|-------------------|
| `library_roots` is empty | Local summary, groups, folders, details, and library queue expansion return empty/not-found results even when global media rows remain. |
| Root path shares only a string prefix | Reject membership unless the next character is `/` (or the paths are equal). |
| Legacy and canonical IDs differ | Resolve references using actual ID, normalized ID, and normalized source path, then delete the actual stored primary key. |
| Overlapping roots | Remove media only after its last membership row disappears. |
| Scan is canceled or fails | Clear only the temporary seen rows; retain the previously committed membership set. |
| Scan reaches a traversal bound or case collision | Call `finalize_partial_library_root_scan`; preserve unseen memberships and return an empty cleanup report. |
| Root deletion while scan is active | Return HTTP 409 / `LIBRARY_ROOT_SCAN_IN_PROGRESS_ERROR` and make no database mutation. |
| Removed path is the pending preload | Invalidate the preload generation and clear all pending path/buffer/readiness state before persisting the queue snapshot. |
| Removed session is still active in memory | Clear `active_session_id` and its NCM scrobble accumulator; later transport calls must not update or append history against the deleted session. |
| Removed path is already loaded and playing | Clear its queue cursor and persist `current_track_path = NULL`, but do not delete the disk file or interrupt buffered playback solely because library membership was removed. |
| Migration 12 fails | Roll back table creation/backfill/cleanup and do not record schema version 12. |
| Foreign-key check after cleanup | Return no rows from `PRAGMA foreign_key_check`; audio files remain present. |

#### 5. Good/Base/Bad Cases

- Good: `finalize_library_root_scan()` receives IDs returned by the metadata write and performs the membership swap plus complete cleanup in one transaction.
- Good: `finalize_partial_library_root_scan()` receives the same final IDs but only upserts them, retains unseen members, and marks the root partial.
- Good: migration 12 uses the persisted default or runtime WebDAV fallback base only for a legacy null `source_key`, while preserving explicit source-key isolation.
- Good: root/media deletion and successful scan cleanup pass their exact cleanup result to `reconcile_runtime_after_library_cleanup()` before notifying consumers.
- Base: global remote/NCM metadata may remain without a membership row, but it is never included in the local-library view.
- Bad: setting only `EVENT_QUEUE_UPDATED` after database cleanup leaves `SharedState.current_track_path`, `pending_file_path`, or `active_session_id` able to resurrect deleted references on the next snapshot sync.
- Bad: selecting all `media_items` for the Library page or deleting `media_id_for_path(source_path)` instead of the row's actual primary key recreates orphan and extended-path bugs.
- Bad: calling `VACUUM`, `remove_file`, or a front-end cache reset as part of the migration hides the data-contract failure and can damage user data.

#### 6. Tests Required

- In-memory database test with local and remote rows but no roots: assert zero library stats, summaries, groups, folders, detail, and queue expansion.
- Migration 12 tests: fresh/v11 upgrade, overlapping local roots, explicit/default/runtime-fallback WebDAV roots, NCM exclusion, legacy `//?/` identity, rollback on trigger failure, and zero foreign-key errors.
- Cleanup test: assert history, sessions, queue entries/state, playlists, covers, NCM mappings, and actual media rows are removed while the source file is untouched.
- Runtime cleanup test: use legacy/ordinary path variants and assert the current queue cursor, pending preload, deleted active session, scrobble state, and persisted queue snapshot are reconciled while an already loaded `file_path` remains playable.
- Scan tests: assert stored IDs are marked seen, failed/canceled scans preserve committed memberships, metadata-refresh failures preserve old members, partial finalize preserves unseen members with zero cleanup, and successful complete finalize removes only last-owner stale media.
- Run `cargo fmt --check`, `cargo test --lib`, `cargo check --bin audio_server`, and a read-only backup verification with `PRAGMA foreign_key_check`.

#### 7. Wrong vs Correct

#### Wrong

```rust
// Recomputing an ID can miss a legacy `//?/` primary key.
conn.execute(
    "DELETE FROM media_items WHERE media_id = ?1",
    params![media_id_for_path(source_path)],
)?;
```

#### Correct

```rust
// Carry the row's actual primary key through the transaction.
let cleanup = cleanup_media_targets_tx(
    &tx,
    &[LibraryCleanupTarget {
        media_id: stored_media_id,
        source_path: stored_source_path,
    }],
)?;
tx.commit()?;
reconcile_runtime_after_library_cleanup(data, &cleanup);
```

For a bounded traversal, selecting the complete finalizer is also wrong:

```rust
// Wrong: deletes memberships that were never visited.
let finalized = db.finalize_library_root_scan(root_id, task_id, finished_at)?;

// Correct: the traversal result selects persistence mode explicitly.
let finalized = if partial_reason.is_some() {
    db.finalize_partial_library_root_scan(root_id, task_id, finished_at)?
} else {
    db.finalize_library_root_scan(root_id, task_id, finished_at)?
};
```

`AppDatabase` uses a versioned migration system. `LoudnessDatabase` still owns its local schema with `init_schema()` and is separate unless a task explicitly targets it.

### AppDatabase migration contract

**Scope / Trigger**

Use this contract for any schema or index change in `app_state.db`.

**Signatures**

```rust
// src/migration.rs
pub fn run_migrations(conn: &mut rusqlite::Connection) -> Result<(), String>
```

```rust
// src/app_database.rs
let mut conn = prepare_connection(conn, enable_wal)?;
migration::run_migrations(&mut conn)?;
```

**Schema version table**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
```

**Migration files**

- SQL migrations live in repository-root `migrations/`.
- SQL migrations are embedded with `include_str!()` from `src/migration.rs`; do not read them from the runtime working directory.
- Keep file names numbered and stable, for example `001_baseline.sql` and `003_indexes.sql`.
- Rust-only migrations are allowed when the migration must inspect existing schema first.

### Adding AppDatabase schema changes

1. Add a numbered migration after the current latest version.
2. Add it to `run_migrations()` in order.
3. Run each migration in a transaction.
4. Record the version only after the migration succeeds.
5. Include the migration version in all error messages.
6. Add tests for fresh databases, already-upgraded databases, and partial/old database upgrade paths.

### Column backfills

Do not rely on `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Existing user databases may have columns created by old ad-hoc code but no `schema_version` row. Inspect `PRAGMA table_info(table_name)` first, then run plain `ALTER TABLE ... ADD COLUMN` only when the column is missing.

#### Wrong

```rust
tx.execute_batch("ALTER TABLE library_roots ADD COLUMN IF NOT EXISTS source_key TEXT")?;
```

#### Correct

```rust
if !column_exists(&tx, "library_roots", "source_key")? {
    tx.execute("ALTER TABLE library_roots ADD COLUMN source_key TEXT", [])?;
}
```

### Validation & error matrix

| Case | Expected behavior |
|------|-------------------|
| Fresh database | Applies baseline and all later migrations; records every version |
| Existing DB with no `schema_version` | Baseline uses `IF NOT EXISTS`; backfills inspect columns before altering |
| Existing DB already partially upgraded | Applies only versions greater than current max version |
| Migration SQL fails | Returns `Err(String)` with migration version and does not record that version |
| In-memory test DB | Runs migrations but skips/tolerates WAL |
| File-backed DB | Enables `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode=WAL` before migrations |

### Required tests

- `schema_version` contains all applied versions for fresh databases.
- Old databases missing a backfilled column upgrade successfully.
- Old databases that already contain the backfilled column upgrade successfully.
- New indexes exist after migration.
- File-backed `AppDatabase::open()` reports WAL mode.

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Tables | `snake_case`, plural | `playback_sessions`, `media_items` |
| Columns | `snake_case` | `source_path`, `updated_at` |
| Indexes | `idx_{table}_{column}` | `idx_media_items_source_path` |
| Primary keys | `{singular}_id` | `session_id`, `media_id` |
| Timestamps | `_at` suffix, epoch seconds | `created_at`, `updated_at`, `ended_at` |
| JSON columns | `_json` suffix | `payload_json`, `result_json` |

---

## Common Mistakes

### Forgetting to drop the lock before calling other methods

```rust
// WRONG: conn is still borrowed when calling self method
let conn = self.conn.lock().map_err(|e| e.to_string())?;
conn.execute(...)?;
drop(conn);  // Must drop before calling another &self method
self.ensure_something()?;
```

### Using `usize` directly in params

SQLite uses `i64`. Always cast `usize` to `i64`:

```rust
// WRONG
params![limit]  // limit is usize

// CORRECT
params![limit as i64]
```

### Not using `.optional()` for queries that may return 0 rows

```rust
// WRONG: panics if no row found
let result = conn.query_row("SELECT ...", [], |row| ...)?;

// CORRECT: returns None if no row found
let result = conn.query_row("SELECT ...", [], |row| ...)
    .optional()
    .map_err(|e| format!("..."))?;
```

---

## Testing

Use `AppDatabase::in_memory()` for tests — creates a temporary in-memory database:

```rust
#[test]
fn test_something() {
    let db = AppDatabase::in_memory().unwrap();
    // ... test operations ...
}
```
