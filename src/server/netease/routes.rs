use super::*;

#[cfg(test)]
pub(super) const DOMAIN_ROUTE_CONTRACTS: &[(&str, &str)] = &[
    ("POST", "/domain/ncm/track/resolve"),
    ("POST", "/domain/ncm/track/play"),
    ("POST", "/domain/ncm/track/enqueue"),
    ("POST", "/domain/ncm/track/supplement"),
    ("POST", "/domain/ncm/track/lyrics"),
    ("POST", "/domain/ncm/home_feed"),
    ("POST", "/domain/ncm/discover/playlists"),
    ("POST", "/domain/ncm/discover/albums"),
    ("POST", "/domain/ncm/discover/artists"),
    ("POST", "/domain/ncm/discover/toplists"),
    ("POST", "/domain/ncm/discover/songs"),
    ("POST", "/domain/ncm/discover/playlist_categories"),
    ("GET", "/domain/ncm/accounts"),
    ("POST", "/domain/ncm/accounts"),
    ("POST", "/domain/ncm/accounts/active"),
    ("POST", "/domain/ncm/accounts/refresh"),
    ("POST", "/domain/ncm/accounts/logout"),
    ("POST", "/domain/ncm/accounts/clear_active"),
    ("POST", "/domain/ncm/accounts/daily_signin"),
    ("POST", "/domain/ncm/user/playlists"),
    ("POST", "/domain/ncm/search/tracks"),
    ("POST", "/domain/ncm/search/playlists"),
    ("POST", "/domain/ncm/playlist/detail"),
    ("POST", "/domain/ncm/playlist/tracks"),
    ("POST", "/domain/ncm/playlist/tracks/update"),
    ("POST", "/domain/ncm/recommend/songs/tracks"),
    ("POST", "/domain/ncm/recommend/songs/dislike"),
    ("POST", "/domain/ncm/song/details/tracks"),
    ("POST", "/domain/ncm/personal_fm/tracks"),
    ("POST", "/domain/ncm/personal_fm/trash"),
    ("POST", "/domain/ncm/heartbeat/tracks"),
    ("POST", "/domain/ncm/album/tracks"),
    ("POST", "/domain/ncm/artist/tracks"),
    ("POST", "/domain/ncm/user/likelist"),
    ("POST", "/domain/ncm/user/cloud"),
    ("POST", "/domain/ncm/user/cloud/delete"),
    ("POST", "/domain/ncm/user/cloud/match"),
    ("DELETE", "/domain/ncm/accounts/{user_id}"),
];

pub(super) fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route(
        "/domain/ncm/track/resolve",
        web::post().to(resolve_ncm_track),
    )
    .route("/domain/ncm/track/play", web::post().to(play_ncm_track))
    .route(
        "/domain/ncm/track/enqueue",
        web::post().to(enqueue_ncm_track),
    )
    .route(
        "/domain/ncm/track/supplement",
        web::post().to(resolve_ncm_track_supplement),
    )
    .route(
        "/domain/ncm/track/lyrics",
        web::post().to(resolve_ncm_track_lyrics),
    )
    .route("/domain/ncm/home_feed", web::post().to(get_ncm_home_feed))
    .route(
        "/domain/ncm/discover/playlists",
        web::post().to(list_ncm_discover_playlists),
    )
    .route(
        "/domain/ncm/discover/albums",
        web::post().to(list_ncm_discover_albums),
    )
    .route(
        "/domain/ncm/discover/artists",
        web::post().to(list_ncm_discover_artists),
    )
    .route(
        "/domain/ncm/discover/toplists",
        web::post().to(list_ncm_discover_toplists),
    )
    .route(
        "/domain/ncm/discover/songs",
        web::post().to(list_ncm_discover_songs),
    )
    .route(
        "/domain/ncm/discover/playlist_categories",
        web::post().to(get_ncm_discover_playlist_categories),
    )
    .route("/domain/ncm/accounts", web::get().to(list_ncm_accounts))
    .route("/domain/ncm/accounts", web::post().to(upsert_ncm_account))
    .route(
        "/domain/ncm/accounts/active",
        web::post().to(set_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/refresh",
        web::post().to(refresh_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/logout",
        web::post().to(logout_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/clear_active",
        web::post().to(clear_active_ncm_account),
    )
    .route(
        "/domain/ncm/accounts/daily_signin",
        web::post().to(daily_signin_active_ncm_account),
    )
    .route(
        "/domain/ncm/user/playlists",
        web::post().to(list_ncm_user_playlists),
    )
    .route(
        "/domain/ncm/search/tracks",
        web::post().to(search_ncm_tracks),
    )
    .route(
        "/domain/ncm/search/playlists",
        web::post().to(search_ncm_playlists),
    )
    .route(
        "/domain/ncm/playlist/tracks",
        web::post().to(list_ncm_playlist_tracks),
    )
    .route(
        "/domain/ncm/playlist/tracks/update",
        web::post().to(update_ncm_playlist_tracks),
    )
    .route(
        "/domain/ncm/playlist/detail",
        web::post().to(get_ncm_playlist_detail),
    )
    .route(
        "/domain/ncm/recommend/songs/tracks",
        web::post().to(list_ncm_daily_song_tracks),
    )
    .route(
        "/domain/ncm/recommend/songs/dislike",
        web::post().to(dislike_ncm_daily_song),
    )
    .route(
        "/domain/ncm/song/details/tracks",
        web::post().to(list_ncm_song_detail_tracks),
    )
    .route(
        "/domain/ncm/personal_fm/tracks",
        web::post().to(list_ncm_personal_fm_tracks),
    )
    .route(
        "/domain/ncm/personal_fm/trash",
        web::post().to(trash_ncm_personal_fm_track),
    )
    .route(
        "/domain/ncm/heartbeat/tracks",
        web::post().to(list_ncm_heartbeat_tracks),
    )
    .route(
        "/domain/ncm/album/tracks",
        web::post().to(list_ncm_album_tracks),
    )
    .route(
        "/domain/ncm/artist/tracks",
        web::post().to(list_ncm_artist_tracks),
    )
    .route(
        "/domain/ncm/user/likelist",
        web::post().to(list_ncm_likelist_ids),
    )
    .route(
        "/domain/ncm/user/cloud",
        web::post().to(list_ncm_cloud_tracks),
    )
    .route(
        "/domain/ncm/user/cloud/delete",
        web::post().to(delete_ncm_cloud_track),
    )
    .route(
        "/domain/ncm/user/cloud/match",
        web::post().to(match_ncm_cloud_track),
    )
    .route(
        "/domain/ncm/accounts/{user_id}",
        web::delete().to(delete_ncm_account),
    )
    .route("/api/netease/{tail:.*}", web::get().to(handle_request))
    .route("/api/netease/{tail:.*}", web::post().to(handle_request));
}

#[cfg(test)]
pub(super) fn domain_route_contracts() -> &'static [(&'static str, &'static str)] {
    DOMAIN_ROUTE_CONTRACTS
}
