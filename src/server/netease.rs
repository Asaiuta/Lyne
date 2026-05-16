use super::lyrics;
use super::*;
use actix_web::{web, HttpResponse};
use ncm_api_rs::{NcmError, Query};
use std::sync::Arc;

mod accounts;
mod cloud;
mod discover;
mod parsers;
mod playback_actions;
mod playlists;
mod proxy;
mod routes;
mod search;
mod tracks;
mod types;

use accounts::*;
use cloud::*;
use discover::*;
use parsers::*;
use playback_actions::*;
use playlists::*;
use proxy::*;
use search::*;
use tracks::*;
use types::*;

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    routes::configure_routes(cfg);
}

fn non_empty_cookie(cookie: &str) -> Option<String> {
    let trimmed = cookie.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn active_ncm_cookie(data: &web::Data<Arc<AppState>>) -> Option<String> {
    match data.app_db.active_ncm_cookie() {
        Ok(cookie) => cookie,
        Err(err) => {
            log::warn!("Failed to read active NCM cookie: {}", err);
            None
        }
    }
}

fn inject_active_ncm_cookie(data: &web::Data<Arc<AppState>>, query: &mut Query) {
    let suppress = query
        .params
        .remove("_ncm_no_active_cookie")
        .or_else(|| query.params.remove("no_active_cookie"))
        .or_else(|| query.params.remove("noCookie"))
        .is_some_and(|value| parse_bool(&value));
    if suppress || query.cookie.is_some() {
        return;
    }
    if let Some(cookie) = active_ncm_cookie(data) {
        query.cookie = Some(cookie);
    }
}

fn attach_cookie(query: &mut Query, cookie: Option<&str>) {
    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        query.cookie = Some(cookie.to_string());
    }
}

/// Canonical envelope mapping for upstream NCM errors emitted by `/domain/ncm/*` handlers.
///
/// Domain endpoints promise the AudioPlayer `{status, message}` shape on error
/// (see `.trellis/spec/backend/error-handling.md`). The raw `/api/netease/*` proxy
/// keeps the upstream `{code, msg}` shape and must NOT route through this helper.
fn ncm_upstream_error_response(err: NcmError) -> HttpResponse {
    match err {
        NcmError::AuthRequired(msg) => unauthorized_response(msg),
        NcmError::InvalidParam(msg) => bad_request_response(msg),
        NcmError::RateLimited(msg) => too_many_requests_response(msg),
        NcmError::Timeout(msg) => gateway_timeout_response(msg),
        NcmError::Api { msg, .. } => bad_gateway_response(msg),
        other => bad_gateway_response(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{
        http::{header, header::HeaderMap, header::HeaderValue, Method, StatusCode},
        test as actix_test, App,
    };
    use ncm_api_rs::{ApiResponse, NcmError, Query};
    use serde_json::{json, Value};

    fn header_map_with_cookie(cookie: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, HeaderValue::from_str(cookie).unwrap());
        headers
    }

    #[test]
    fn route_to_method_replaces_slashes() {
        assert_eq!(normalize_route("/login/qr/key/"), "login/qr/key");
        assert_eq!(route_to_method("login/qr/key"), "login_qr_key");
    }

    #[actix_web::test]
    async fn domain_ncm_routes_remain_stable_after_handler_split() {
        let app = actix_test::init_service(App::new().configure(super::configure_routes)).await;

        for &(method, path) in routes::domain_route_contracts() {
            let concrete_path = path.replace("{user_id}", "42");
            let expected_method =
                Method::from_bytes(method.as_bytes()).expect("valid route method");

            let request = actix_test::TestRequest::default()
                .method(expected_method)
                .uri(&concrete_path)
                .to_request();
            let response = actix_test::call_service(&app, request).await;
            assert_ne!(
                response.status(),
                StatusCode::NOT_FOUND,
                "expected route {} {} to stay registered after handler split",
                method,
                path
            );
            assert_ne!(
                response.status(),
                StatusCode::METHOD_NOT_ALLOWED,
                "expected route {} {} to keep accepting its configured method after handler split",
                method,
                path
            );
        }
    }

    #[test]
    fn phase9_identity_routes_resolve_to_dispatch_keys() {
        // Every Phase 9 route below MUST land on a dispatch arm in `dispatch()`.
        // The mapping is `path → snake_case method name`. If you rename a
        // dispatch arm you must update both sides.
        let cases = [
            ("/user/account", "user_account"),
            ("/user/detail", "user_detail"),
            ("/user/subcount", "user_subcount"),
            ("/user/level", "user_level"),
            ("/likelist", "likelist"),
            ("/daily_signin", "daily_signin"),
            ("/scrobble", "scrobble"),
        ];
        for (path, expected) in cases {
            let normalized = normalize_route(path);
            let method = route_to_method(&normalized);
            assert_eq!(
                method, expected,
                "route {} should resolve to method {}",
                path, expected
            );
        }
    }

    #[test]
    fn home_feed_routes_resolve_to_dispatch_keys() {
        // Routes that power the Apple-Music-style recommend home feed. Each
        // pair must land on a dispatch arm in `dispatch()`.
        let cases = [
            ("/personalized", "personalized"),
            ("/personalized/newsong", "personalized_newsong"),
            ("/personalized/mv", "personalized_mv"),
            ("/personalized/djprogram", "personalized_djprogram"),
            ("/recommend/resource", "recommend_resource"),
            ("/recommend/songs", "recommend_songs"),
            ("/fm_trash", "fm_trash"),
            ("/personal_fm", "personal_fm"),
            ("/top/artists", "top_artists"),
            ("/album/newest", "album_newest"),
            ("/dj/personalize/recommend", "dj_personalize_recommend"),
            ("/dj/catelist", "dj_catelist"),
            ("/dj/category/recommend", "dj_category_recommend"),
            ("/dj/detail", "dj_detail"),
            ("/dj/program", "dj_program"),
            ("/dj/radio/hot", "dj_radio_hot"),
            ("/dj/recommend", "dj_recommend"),
            ("/dj/recommend/type", "dj_recommend_type"),
            ("/dj/sub", "dj_sub"),
            ("/dj/toplist", "dj_toplist"),
            ("/mv/first", "mv_first"),
        ];
        for (path, expected) in cases {
            let normalized = normalize_route(path);
            let method = route_to_method(&normalized);
            assert_eq!(
                method, expected,
                "route {} should resolve to method {}",
                path, expected
            );
        }
    }

    #[test]
    fn splayer_discover_routes_resolve_to_dispatch_keys() {
        // SPlayer Discover tabs call these NCM endpoints:
        // playlists, toplists, artists, and newest music.
        let cases = [
            ("/top/playlist", "top_playlist"),
            ("/top/playlist/highquality", "top_playlist_highquality"),
            ("/toplist/detail", "toplist_detail"),
            ("/artist/list", "artist_list"),
            ("/album/new", "album_new"),
            ("/top/song", "top_song"),
        ];
        for (path, expected) in cases {
            let normalized = normalize_route(path);
            let method = route_to_method(&normalized);
            assert_eq!(
                method, expected,
                "route {} should resolve to method {}",
                path, expected
            );
        }
    }

    #[test]
    fn merged_query_prefers_body_then_cookie_param() {
        let headers = header_map_with_cookie("foo=header; other=1");
        let body = br#"{"foo":"body","cookie":"foo=param; traced=1","ua":"pc"}"#;
        let query = extract_merged_query(
            &headers,
            Some("foo=query&realIP=1.2.3.4"),
            body,
            Some("application/json"),
        )
        .expect("query should parse");

        assert_eq!(query.cookie.as_deref(), Some("foo=param; traced=1"));
        assert_eq!(query.real_ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(query.ua.as_deref(), Some("pc"));
        assert_eq!(query.params.get("foo").map(String::as_str), Some("body"));
    }

    #[test]
    fn apply_query_overrides_extracts_known_fields() {
        let mut query = Query::new()
            .param("randomCNIP", "true")
            .param("proxy", "http://127.0.0.1:9000")
            .param("e_r", "1")
            .param("domain", "https://music.163.com");

        apply_query_overrides(&mut query).expect("overrides should parse");

        assert!(query.random_cn_ip);
        assert_eq!(query.proxy.as_deref(), Some("http://127.0.0.1:9000"));
        assert_eq!(query.e_r, Some(true));
        assert_eq!(query.domain.as_deref(), Some("https://music.163.com"));
        assert!(query.params.is_empty());
    }

    #[test]
    fn read_song_url_extracts_first_stream_url() {
        let payload = json!({
            "data": [
                { "id": 42, "url": "https://m701.music.126.net/song.flac" }
            ]
        });

        assert_eq!(
            read_song_url(&payload).as_deref(),
            Some("https://m701.music.126.net/song.flac")
        );
    }

    #[test]
    fn read_song_detail_prefers_matching_song_and_modern_fields() {
        let payload = json!({
            "songs": [
                {
                    "id": 1,
                    "name": "Wrong",
                    "ar": [{ "name": "Wrong Artist" }],
                    "al": { "name": "Wrong Album", "picUrl": "wrong.jpg" }
                },
                {
                    "id": 42,
                    "name": "Needle",
                    "ar": [{ "id": 10, "name": "A" }, { "id": 11, "name": "B" }],
                    "al": { "name": "Album", "picUrl": "cover.jpg" }
                }
            ]
        });

        assert_eq!(
            read_song_detail(&payload, 42),
            Some(NcmTrackDetail {
                title: Some("Needle".to_string()),
                artist: Some("A, B".to_string()),
                artists: vec![
                    NcmArtistSummary {
                        id: 10,
                        name: "A".to_string(),
                    },
                    NcmArtistSummary {
                        id: 11,
                        name: "B".to_string(),
                    },
                ],
                album: Some("Album".to_string()),
                cover_url: Some("cover.jpg".to_string()),
            })
        );
    }

    #[test]
    fn read_song_detail_supports_legacy_fields() {
        let payload = json!({
            "songs": [
                {
                    "id": 42,
                    "name": "Legacy",
                    "artists": [{ "id": 99, "name": "Legacy Artist" }],
                    "album": { "name": "Legacy Album" },
                    "picUrl": "legacy.jpg"
                }
            ]
        });

        assert_eq!(
            read_song_detail(&payload, 42),
            Some(NcmTrackDetail {
                title: Some("Legacy".to_string()),
                artist: Some("Legacy Artist".to_string()),
                artists: vec![NcmArtistSummary {
                    id: 99,
                    name: "Legacy Artist".to_string(),
                }],
                album: Some("Legacy Album".to_string()),
                cover_url: Some("legacy.jpg".to_string()),
            })
        );
    }

    #[test]
    fn read_profile_snapshot_supports_wrapped_login_status_shape() {
        let payload = json!({
            "data": {
                "account": { "id": 42, "userName": "fallback", "vipType": 10 },
                "profile": {
                    "userId": 42,
                    "nickname": "Ada",
                    "avatarUrl": "https://example.test/a.jpg",
                    "vipType": 11
                },
                "level": 8
            }
        });

        assert_eq!(
            read_profile_snapshot(&payload),
            Some(NcmProfileSnapshot {
                user_id: 42,
                nickname: Some("Ada".to_string()),
                avatar_url: Some("https://example.test/a.jpg".to_string()),
                vip_type: Some(11),
                level: Some(8),
            })
        );
    }

    #[test]
    fn read_user_playlists_returns_sanitized_summaries() {
        let payload = json!({
            "playlist": [
                {
                    "id": 1,
                    "name": "Created",
                    "creator": { "nickname": "Ada" },
                    "coverImgUrl": "cover-a.jpg",
                    "trackCount": 12,
                    "subscribed": false
                },
                {
                    "id": 2,
                    "name": "Collected",
                    "creator": { "nickname": "Grace" },
                    "coverImgUrl": "cover-b.jpg",
                    "trackCount": 34,
                    "subscribed": true
                }
            ]
        });

        let playlists = read_user_playlists(&payload);
        assert_eq!(playlists.len(), 2);
        assert_eq!(playlists[0].name, "Created");
        assert_eq!(
            filter_playlist_summaries(playlists.clone(), Some("collected-playlists")),
            vec![NcmPlaylistSummary {
                id: 2,
                name: "Collected".to_string(),
                creator: Some("Grace".to_string()),
                cover_url: Some("cover-b.jpg".to_string()),
                track_count: Some(34),
                subscribed: true,
            }]
        );
    }

    #[test]
    fn read_search_tracks_returns_stable_track_dto() {
        let payload = json!({
            "result": {
                "songs": [
                    {
                        "id": 42,
                        "name": "Needle",
                        "ar": [{ "name": "A" }, { "name": "B" }],
                        "al": { "name": "Album", "picUrl": "cover.jpg" },
                        "dt": 180000
                    },
                    { "id": 43 }
                ]
            }
        });

        assert_eq!(
            read_search_tracks(&payload),
            vec![NcmTrackSummary {
                id: "ncm-song-42".to_string(),
                song_id: 42,
                source_path: "https://music.163.com/#/song?id=42".to_string(),
                title: Some("Needle".to_string()),
                artist: Some("A, B".to_string()),
                album: Some("Album".to_string()),
                duration_secs: Some(180.0),
                artwork_url: Some("cover.jpg".to_string()),
                size_bytes: None,
            }]
        );
    }

    #[test]
    fn read_search_playlists_returns_sanitized_summaries() {
        let payload = json!({
            "result": {
                "playlists": [
                    {
                        "id": 100,
                        "name": "Mix",
                        "creator": { "nickname": "Ada" },
                        "coverImgUrl": "cover.jpg",
                        "trackCount": 12
                    },
                    { "id": 101 }
                ]
            }
        });

        assert_eq!(
            read_search_playlists(&payload),
            vec![NcmPlaylistSummary {
                id: 100,
                name: "Mix".to_string(),
                creator: Some("Ada".to_string()),
                cover_url: Some("cover.jpg".to_string()),
                track_count: Some(12),
                subscribed: false,
            }]
        );
    }

    #[test]
    fn read_playlist_tracks_supports_root_songs_and_legacy_fields() {
        let payload = json!({
            "songs": [
                {
                    "id": 7,
                    "name": "Legacy",
                    "artists": [{ "name": "Legacy Artist" }],
                    "album": { "name": "Legacy Album", "picUrl": "legacy.jpg" },
                    "duration": 90000
                }
            ]
        });

        assert_eq!(
            read_playlist_tracks(&payload),
            vec![NcmTrackSummary {
                id: "ncm-song-7".to_string(),
                song_id: 7,
                source_path: "https://music.163.com/#/song?id=7".to_string(),
                title: Some("Legacy".to_string()),
                artist: Some("Legacy Artist".to_string()),
                album: Some("Legacy Album".to_string()),
                duration_secs: Some(90.0),
                artwork_url: Some("legacy.jpg".to_string()),
                size_bytes: None,
            }]
        );
    }

    #[test]
    fn read_discover_cards_support_common_section_shapes() {
        let playlists = json!({
            "playlists": [{
                "id": 1,
                "name": "Playlist",
                "creator": { "nickname": "Ada" },
                "coverImgUrl": "playlist.jpg",
                "updateTime": 1710000000000_i64
            }],
            "more": true
        });
        let albums = json!({
            "albums": [{
                "id": 2,
                "name": "Album",
                "artists": [{ "name": "Artist" }],
                "picUrl": "album.jpg",
                "publishTime": 1710000000001_i64
            }],
            "total": 100
        });
        let artists = json!({
            "artists": [{
                "id": 3,
                "name": "Singer",
                "img1v1Url": "artist.jpg"
            }]
        });

        let playlist_card = &read_discover_playlist_cards(&playlists)[0];
        assert_eq!(playlist_card.subtitle.as_deref(), Some("Ada"));
        assert_eq!(playlist_card.cursor, Some(1710000000000));
        assert!(read_page_has_more(&playlists, 50, 0, 1));

        let album_card = &read_discover_album_cards(&albums)[0];
        assert_eq!(album_card.subtitle.as_deref(), Some("Artist"));
        assert_eq!(album_card.cursor, Some(1710000000001));
        assert!(read_page_has_more(&albums, 50, 0, 1));

        let artist_card = &read_discover_artist_cards(&artists)[0];
        assert_eq!(artist_card.cover_url.as_deref(), Some("artist.jpg"));
    }

    #[test]
    fn read_discover_toplists_categories_and_wrapped_tracks() {
        let toplists = json!({
            "list": [{
                "id": 4,
                "name": "Hot",
                "updateTip": "daily",
                "description": "desc",
                "coverImgUrl": "top.jpg",
                "ToplistType": "S",
                "tracks": [
                    { "first": "Song", "second": "Artist" },
                    { "name": "Modern", "ar": [{ "name": "A" }, { "name": "B" }] }
                ]
            }]
        });
        let categories = json!({
            "categories": { "0": "语种" },
            "sub": [{ "name": "华语", "category": 0, "hot": true }]
        });
        let hq_tags = json!({
            "tags": [{ "name": "华语" }]
        });
        let top_songs = json!({
            "data": [{
                "song": {
                    "id": 5,
                    "name": "Top Song",
                    "artists": [{ "name": "Singer" }],
                    "album": { "name": "Album", "picUrl": "song.jpg" },
                    "duration": 210000
                }
            }]
        });

        let toplist = &read_discover_toplists(&toplists)[0];
        assert!(toplist.is_official);
        assert_eq!(toplist.tracks[1].artist.as_deref(), Some("A, B"));

        let category_state = read_discover_playlist_categories(&categories, &hq_tags);
        assert_eq!(
            category_state.categories.get(&0).map(String::as_str),
            Some("语种")
        );
        assert_eq!(category_state.entries[0].name, "华语");
        assert_eq!(category_state.hq_names, vec!["华语".to_string()]);

        assert_eq!(
            read_top_song_tracks(&top_songs),
            vec![NcmTrackSummary {
                id: "ncm-song-5".to_string(),
                song_id: 5,
                source_path: "https://music.163.com/#/song?id=5".to_string(),
                title: Some("Top Song".to_string()),
                artist: Some("Singer".to_string()),
                album: Some("Album".to_string()),
                duration_secs: Some(210.0),
                artwork_url: Some("song.jpg".to_string()),
                size_bytes: None,
            }]
        );
    }

    #[test]
    fn read_home_feed_cards_support_common_section_shapes() {
        let personalized = json!({
            "result": [{
                "id": 1,
                "name": "Playlist",
                "copywriter": "copy",
                "picUrl": "playlist.jpg",
                "playCount": 1234,
                "description": "desc"
            }]
        });
        let resource = json!({
            "recommend": [{
                "id": 2,
                "name": "Daily",
                "creator": { "nickname": "Ada" },
                "picUrl": "daily.jpg",
                "playcount": 4321
            }]
        });
        let albums = json!({
            "albums": [{
                "id": 3,
                "name": "Album",
                "artist": { "name": "Artist" },
                "picUrl": "album.jpg"
            }]
        });
        let artists = json!({
            "artists": [{
                "id": 4,
                "name": "Singer",
                "img1v1Url": "artist.jpg"
            }]
        });
        let mvs = json!({
            "result": [{
                "id": 5,
                "name": "MV",
                "artistName": "Director",
                "cover": "mv.jpg",
                "playCount": 55
            }]
        });
        let djs = json!({
            "result": [{
                "id": 6,
                "name": "Podcast",
                "copywriter": "story",
                "picUrl": "podcast.jpg",
                "playCount": 66
            }]
        });

        assert_eq!(
            read_personalized_playlist_cards(&personalized)[0].title,
            "Playlist"
        );
        assert_eq!(
            read_recommend_resource_cards(&resource)[0]
                .subtitle
                .as_deref(),
            Some("Ada")
        );
        assert_eq!(
            read_newest_album_cards(&albums)[0].subtitle.as_deref(),
            Some("Artist")
        );
        assert_eq!(
            read_top_artist_cards(&artists)[0].cover_url.as_deref(),
            Some("artist.jpg")
        );
        assert_eq!(
            read_personalized_mv_cards(&mvs)[0].cover_url.as_deref(),
            Some("mv.jpg")
        );
        assert_eq!(
            read_personalized_dj_cards(&djs)[0].description.as_deref(),
            Some("story")
        );
    }

    #[test]
    fn read_home_feed_radar_and_personal_fm_preview() {
        let radar = json!({
            "playlist": {
                "id": 7,
                "name": "Radar",
                "creator": { "nickname": "NetEase" },
                "coverImgUrl": "radar.jpg",
                "playCount": 777,
                "description": "fresh"
            }
        });
        let track = NcmTrackSummary {
            id: "ncm-song-8".to_string(),
            song_id: 8,
            source_path: "https://music.163.com/#/song?id=8".to_string(),
            title: Some("FM".to_string()),
            artist: Some("Artist".to_string()),
            album: Some("Album".to_string()),
            duration_secs: Some(30.0),
            artwork_url: Some("fm.jpg".to_string()),
            size_bytes: None,
        };

        let card = read_radar_playlist_card(&radar).expect("radar card");
        assert_eq!(card.title, "Radar");
        assert_eq!(card.cover_url.as_deref(), Some("radar.jpg"));
        assert_eq!(
            track_covers(&[track.clone()]),
            vec![NcmHomeTrackCover {
                id: 8,
                url: Some("fm.jpg".to_string())
            }]
        );
        assert_eq!(
            personal_fm_preview(&[track]).map(|preview| preview.title),
            Some("FM".to_string())
        );
    }

    #[test]
    fn read_daily_personal_and_artist_tracks_use_expected_roots() {
        let song = json!({
            "id": 9,
            "name": "Rooted",
            "artists": [{ "name": "Artist" }],
            "album": { "name": "Album", "picUrl": "cover.jpg" },
            "duration": 60000
        });

        assert_eq!(
            read_daily_song_tracks(&json!({ "data": { "dailySongs": [song.clone()] } })).len(),
            1
        );
        assert_eq!(
            read_personal_fm_tracks(&json!({ "data": [song.clone()] })).len(),
            1
        );
        assert_eq!(read_artist_tracks(&json!({ "hotSongs": [song] })).len(), 1);
    }

    #[test]
    fn read_likelist_ids_supports_wrapped_and_root_shapes() {
        assert_eq!(
            read_likelist_ids(&json!({ "data": { "ids": [1, 2, "bad", 3] } })),
            vec![1, 2, 3]
        );
        assert_eq!(read_likelist_ids(&json!({ "ids": [4, 5] })), vec![4, 5]);
    }

    #[test]
    fn domain_override_requires_https_and_allowlist() {
        let http_err =
            normalize_domain_override("http://music.163.com").expect_err("http should be rejected");
        assert!(http_err.contains("https"));

        let host_err = normalize_domain_override("https://example.com")
            .expect_err("non-allowlisted host should be rejected");
        assert!(host_err.contains("not allowed"));
    }

    async fn read_json_body(response: actix_web::HttpResponse) -> Value {
        let body = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        serde_json::from_slice(&body).expect("body should be JSON")
    }

    #[actix_web::test]
    async fn raw_success_response_preserves_upstream_body_code() {
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({
                "code": 803,
                "message": "authorized",
                "cookie": "from_upstream=1",
            }),
            cookie: Vec::new(),
        });

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            read_json_body(response).await,
            json!({
                "code": 803,
                "message": "authorized",
                "cookie": "from_upstream=1",
            }),
            "raw /api/netease responses must keep upstream body fields verbatim"
        );
    }

    #[actix_web::test]
    async fn success_response_forwards_set_cookie_headers() {
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({ "code": 200 }),
            cookie: vec!["foo=bar; Path=/; HttpOnly".to_string()],
        });

        assert_eq!(response.status(), StatusCode::OK);
        let cookies: Vec<_> = response.headers().get_all(header::SET_COOKIE).collect();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].to_str().ok(), Some("foo=bar; Path=/; HttpOnly"));
    }

    #[actix_web::test]
    async fn success_response_injects_joined_cookie_into_body() {
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({ "code": 200 }),
            cookie: vec![
                "MUSIC_U=abc123; Path=/; HttpOnly".to_string(),
                "MUSIC_A_T=def456; Path=/; HttpOnly".to_string(),
            ],
        });

        let bytes = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        let parsed: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(
            parsed.get("cookie").and_then(Value::as_str),
            Some("MUSIC_U=abc123; MUSIC_A_T=def456"),
            "joined cookie pairs (without attributes) should appear in body"
        );
    }

    #[actix_web::test]
    async fn success_response_preserves_upstream_cookie_field() {
        // /login/qr/check populates `cookie` itself; we must not clobber it.
        let response = build_success_response(ApiResponse {
            status: 200,
            body: json!({ "code": 803, "cookie": "from_upstream=1" }),
            cookie: vec!["from_set_cookie=2; Path=/".to_string()],
        });

        let bytes = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        let parsed: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(
            parsed.get("cookie").and_then(Value::as_str),
            Some("from_upstream=1"),
            "upstream-provided cookie field must take precedence"
        );
    }

    #[test]
    fn join_cookie_pairs_strips_attributes() {
        let cookies = vec![
            "MUSIC_U=abc; Path=/; HttpOnly; SameSite=Lax".to_string(),
            "MUSIC_A_T=def; Domain=.music.163.com; Secure".to_string(),
            "  ".to_string(),                        // whitespace -> dropped
            "garbage_no_equals; Path=/".to_string(), // no `=` -> dropped
        ];
        assert_eq!(join_cookie_pairs(&cookies), "MUSIC_U=abc; MUSIC_A_T=def");
    }

    #[actix_web::test]
    async fn error_response_normalizes_invalid_param() {
        let response = build_error_response(NcmError::InvalidParam("bad input".to_string()));
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let body = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("body should serialize");
        assert_eq!(body, br#"{"code":400,"msg":"bad input"}"#.as_slice());
    }

    #[actix_web::test]
    async fn raw_rate_limit_error_keeps_http_status_and_upstream_code_distinct() {
        let response = build_error_response(NcmError::RateLimited("slow down".to_string()));

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            read_json_body(response).await,
            json!({"code": 503, "msg": "slow down"}),
            "raw /api/netease errors expose the upstream-compatible body code"
        );
    }

    async fn read_canonical_error_body(response: actix_web::HttpResponse) -> Value {
        read_json_body(response).await
    }

    #[actix_web::test]
    async fn upstream_error_maps_auth_required_to_canonical_envelope() {
        let response =
            ncm_upstream_error_response(NcmError::AuthRequired("login required".to_string()));
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            read_canonical_error_body(response).await,
            json!({"status": "error", "message": "login required"})
        );
    }

    #[actix_web::test]
    async fn upstream_error_maps_invalid_param_to_canonical_envelope() {
        let response =
            ncm_upstream_error_response(NcmError::InvalidParam("missing id".to_string()));
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            read_canonical_error_body(response).await,
            json!({"status": "error", "message": "missing id"})
        );
    }

    #[actix_web::test]
    async fn upstream_error_maps_rate_limited_to_canonical_envelope() {
        let response = ncm_upstream_error_response(NcmError::RateLimited("slow down".to_string()));
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            read_canonical_error_body(response).await,
            json!({"status": "error", "message": "slow down"})
        );
    }

    #[actix_web::test]
    async fn upstream_error_maps_timeout_to_canonical_envelope() {
        let response = ncm_upstream_error_response(NcmError::Timeout("upstream slow".to_string()));
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(
            read_canonical_error_body(response).await,
            json!({"status": "error", "message": "upstream slow"})
        );
    }

    #[actix_web::test]
    async fn upstream_error_maps_api_to_bad_gateway() {
        let response = ncm_upstream_error_response(NcmError::Api {
            code: 512,
            msg: "VIP only".to_string(),
        });
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            read_canonical_error_body(response).await,
            json!({"status": "error", "message": "VIP only"})
        );
    }

    #[actix_web::test]
    async fn upstream_error_maps_unknown_variant_to_bad_gateway() {
        let response =
            ncm_upstream_error_response(NcmError::Unknown("unhandled upstream".to_string()));
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let body = read_canonical_error_body(response).await;
        assert_eq!(body["status"], "error");
        assert!(
            body["message"]
                .as_str()
                .is_some_and(|msg| msg.contains("unhandled upstream")),
            "expected upstream message to flow through to canonical body, got {body}"
        );
    }

    #[test]
    fn domain_handlers_never_use_raw_proxy_error_helper() {
        const HANDLER_SOURCES: &[(&str, &str)] = &[
            ("accounts.rs", include_str!("netease/accounts.rs")),
            ("cloud.rs", include_str!("netease/cloud.rs")),
            ("discover.rs", include_str!("netease/discover.rs")),
            (
                "playback_actions.rs",
                include_str!("netease/playback_actions.rs"),
            ),
            ("playlists.rs", include_str!("netease/playlists.rs")),
            ("search.rs", include_str!("netease/search.rs")),
            ("tracks.rs", include_str!("netease/tracks.rs")),
        ];

        let offenders: Vec<&str> = HANDLER_SOURCES
            .iter()
            .filter_map(|(name, content)| content.contains("build_error_response").then_some(*name))
            .collect();

        assert!(
            offenders.is_empty(),
            "build_error_response leaked into {:?}; /domain/ncm/* handlers must call \
             ncm_upstream_error_response (raw {{code, msg}} body is reserved for /api/netease/* in proxy.rs)",
            offenders
        );
    }
}
