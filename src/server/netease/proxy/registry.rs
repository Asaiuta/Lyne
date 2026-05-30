use ncm_api_rs::{ApiClient, ApiResponse, CryptoType, NcmError, Query, RequestOption};
use serde_json::json;

#[derive(Debug)]
pub(super) enum DispatchError {
    UnsupportedRoute,
    RegistryDrift {
        method: String,
        group: ProxyRouteGroup,
    },
    Ncm(NcmError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::server::netease) enum ProxyRouteGroup {
    Auth,
    Search,
    Catalog,
    Playlist,
    User,
    Cloud,
    Recommend,
    Dj,
    Mv,
    Comment,
}

macro_rules! proxy_route_group {
    (
        $methods:ident,
        $dispatch_fn:ident,
        |$client:ident, $query:ident| {
            $($method:literal => $call:expr),+ $(,)?
        }
    ) => {
        const $methods: &[&str] = &[$($method),+];

        async fn $dispatch_fn(
            $client: &ApiClient,
            method: &str,
            $query: &Query,
        ) -> Option<DispatchResult> {
            match method {
                $($method => Some(map_ncm_response($call)),)+
                _ => None,
            }
        }
    };
}

proxy_route_group!(AUTH_PROXY_METHODS, dispatch_auth_route, |client, query| {
    "inner_version" => client.inner_version().await,
    "login" => client.login(query).await,
    "login_cellphone" => client.login_cellphone(query).await,
    "login_qr_key" => request_login_qr_key(client, query).await,
    "login_qr_create" => client.login_qr_create(query).await,
    "login_qr_check" => request_login_qr_check(client, query).await,
    "login_refresh" => client.login_refresh(query).await,
    "login_status" => client.login_status(query).await,
    "logout" => client.logout(query).await,
    "register_anonimous" => client.register_anonimous(query).await,
    "register_cellphone" => client.register_cellphone(query).await,
    "captcha_sent" => client.captcha_sent(query).await,
    "captcha_verify" => client.captcha_verify(query).await,
    "cellphone_existence_check" => client.cellphone_existence_check(query).await,
    "activate_init_profile" => client.activate_init_profile(query).await,
});

proxy_route_group!(SEARCH_PROXY_METHODS, dispatch_search_route, |client, query| {
    "search" => client.search(query).await,
    "cloudsearch" => client.cloudsearch(query).await,
    "search_default" => client.search_default(query).await,
    "search_hot" => client.search_hot(query).await,
    "search_hot_detail" => client.search_hot_detail(query).await,
    "search_suggest" => client.search_suggest(query).await,
    "search_suggest_pc" => client.search_suggest_pc(query).await,
    "search_multimatch" => client.search_multimatch(query).await,
    "search_match" => client.search_match(query).await,
});

proxy_route_group!(CATALOG_PROXY_METHODS, dispatch_catalog_route, |client, query| {
    "song_detail" => client.song_detail(query).await,
    "song_music_detail" => client.song_music_detail(query).await,
    "song_wiki_summary" => client.song_wiki_summary(query).await,
    "sheet_list" => client.sheet_list(query).await,
    "sheet_preview" => client.sheet_preview(query).await,
    "music_first_listen_info" => client.music_first_listen_info(query).await,
    "check_music" => client.check_music(query).await,
    "lyric" => client.lyric(query).await,
    "lyric_new" => client.lyric_new(query).await,
    "album" => client.album(query).await,
    "album_detail" => client.album_detail(query).await,
    "album_detail_dynamic" => client.album_detail_dynamic(query).await,
    "album_newest" => client.album_newest(query).await,
    "album_new" => client.album_new(query).await,
    "artist_detail" => client.artist_detail(query).await,
    "artists" => client.artists(query).await,
    "artist_songs" => client.artist_songs(query).await,
    "artist_album" => client.artist_album(query).await,
    "artist_mv" => client.artist_mv(query).await,
    "artist_list" => client.artist_list(query).await,
    "top_artists" => client.top_artists(query).await,
    "top_song" => client.top_song(query).await,
    "song_url" => client.song_url(query).await,
    "song_url_v1" => client.song_url_v1(query).await,
    "song_url_ncmget" => client.song_url_ncmget(query).await,
    "song_url_match" => client.song_url_match(query).await,
});

proxy_route_group!(PLAYLIST_PROXY_METHODS, dispatch_playlist_route, |client, query| {
    "playlist_detail" => client.playlist_detail(query).await,
    "playlist_detail_dynamic" => client.playlist_detail_dynamic(query).await,
    "playlist_tracks" => client.playlist_tracks(query).await,
    "playlist_track_all" => client.playlist_track_all(query).await,
    "playlist_create" => client.playlist_create(query).await,
    "playlist_delete" => client.playlist_delete(query).await,
    "playlist_subscribe" => client.playlist_subscribe(query).await,
    "playlist_catlist" => client.playlist_catlist(query).await,
    "playlist_category_list" => client.playlist_category_list(query).await,
    "playlist_hot" => client.playlist_hot(query).await,
    "playlist_highquality_tags" => client.playlist_highquality_tags(query).await,
    "playlist_update" => client.playlist_update(query).await,
    "playlist_name_update" => client.playlist_name_update(query).await,
    "playlist_desc_update" => client.playlist_desc_update(query).await,
    "playlist_tags_update" => client.playlist_tags_update(query).await,
    "playlist_order_update" => client.playlist_order_update(query).await,
    "playlist_update_playcount" => client.playlist_update_playcount(query).await,
    "playlist_subscribers" => client.playlist_subscribers(query).await,
    "playlist_detail_rcmd_get" => client.playlist_detail_rcmd_get(query).await,
    "playlist_mylike" => client.playlist_mylike(query).await,
    "toplist" => client.toplist(query).await,
    "toplist_detail" => client.toplist_detail(query).await,
    "toplist_detail_v2" => client.toplist_detail_v2(query).await,
    "toplist_artist" => client.toplist_artist(query).await,
    "top_playlist" => client.top_playlist(query).await,
    "top_playlist_highquality" => client.top_playlist_highquality(query).await,
    "top_list" => client.top_list(query).await,
});

proxy_route_group!(USER_PROXY_METHODS, dispatch_user_route, |client, query| {
    "user_playlist" => client.user_playlist(query).await,
    "user_playlist_create" => client.user_playlist_create(query).await,
    "user_playlist_collect" => client.user_playlist_collect(query).await,
    "user_account" => client.user_account(query).await,
    "user_cloud" => client.user_cloud(query).await,
    "user_cloud_del" => client.user_cloud_del(query).await,
    "user_cloud_detail" => client.user_cloud_detail(query).await,
    "user_detail" => client.user_detail(query).await,
    "user_subcount" => client.user_subcount(query).await,
    "user_level" => client.user_level(query).await,
    "album_sub" => client.album_sub(query).await,
    "album_sublist" => client.album_sublist(query).await,
    "artist_sub" => client.artist_sub(query).await,
    "artist_sublist" => client.artist_sublist(query).await,
    "mv_sublist" => client.mv_sublist(query).await,
    "dj_sublist" => client.dj_sublist(query).await,
    "likelist" => client.likelist(query).await,
    "like" => client.like(query).await,
    "daily_signin" => client.daily_signin(query).await,
    "scrobble" => client.scrobble(query).await,
});

proxy_route_group!(CLOUD_PROXY_METHODS, dispatch_cloud_route, |client, query| {
    "cloud_match" => client.cloud_match(query).await,
    "cloud_import_check" => client.cloud_import_check(query).await,
    "cloud_import" => client.cloud_import(query).await,
    "cloud_upload_check" => client.cloud_upload_check(query).await,
    "cloud_upload_info" => client.cloud_upload_info(query).await,
    "cloud_publish" => client.cloud_publish(query).await,
    "cloud_upload_token_check" => client.cloud_upload_token_check(query).await,
    "cloud_upload_token_alloc" => client.cloud_upload_token_alloc(query).await,
    "cloud_upload_complete_info" => client.cloud_upload_complete_info(query).await,
    "cloud_upload_complete_pub" => client.cloud_upload_complete_pub(query).await,
    "cloud_lyric_get" => client.cloud_lyric_get(query).await,
});

proxy_route_group!(RECOMMEND_PROXY_METHODS, dispatch_recommend_route, |client, query| {
    "personalized" => client.personalized(query).await,
    "personalized_newsong" => client.personalized_newsong(query).await,
    "personalized_mv" => client.personalized_mv(query).await,
    "personalized_djprogram" => client.personalized_djprogram(query).await,
    "recommend_resource" => client.recommend_resource(query).await,
    "recommend_songs" => client.recommend_songs(query).await,
    "recommend_songs_dislike" => client.recommend_songs_dislike(query).await,
    "fm_trash" => client.fm_trash(query).await,
    "personal_fm" => client.personal_fm(query).await,
});

proxy_route_group!(DJ_PROXY_METHODS, dispatch_dj_route, |client, query| {
    "dj_personalize_recommend" => client.dj_personalize_recommend(query).await,
    "dj_catelist" => client.dj_catelist(query).await,
    "dj_category_recommend" => client.dj_category_recommend(query).await,
    "dj_detail" => client.dj_detail(query).await,
    "dj_program" => client.dj_program(query).await,
    "dj_program_detail" => client.dj_program_detail(query).await,
    "dj_radio_hot" => client.dj_radio_hot(query).await,
    "dj_recommend" => client.dj_recommend(query).await,
    "dj_recommend_type" => client.dj_recommend_type(query).await,
    "dj_sub" => client.dj_sub(query).await,
    "dj_toplist" => client.dj_toplist(query).await,
});

proxy_route_group!(MV_PROXY_METHODS, dispatch_mv_route, |client, query| {
    "mv_first" => client.mv_first(query).await,
    "mv_all" => client.mv_all(query).await,
    "mv_detail" => client.mv_detail(query).await,
    "mv_detail_info" => client.mv_detail_info(query).await,
    "mv_url" => client.mv_url(query).await,
    "video_detail" => client.video_detail(query).await,
    "video_detail_info" => client.video_detail_info(query).await,
    "video_url" => client.video_url(query).await,
});

proxy_route_group!(COMMENT_PROXY_METHODS, dispatch_comment_route, |client, query| {
    "comment_music" => client.comment_music(query).await,
    "comment_new" => client.comment_new(query).await,
    "comment_hot" => client.comment_hot(query).await,
    "comment_like" => client.comment_like(query).await,
    "hug_comment" => client.hug_comment(query).await,
    "comment_hug_list" => client.comment_hug_list(query).await,
});

const PROXY_METHOD_REGISTRY: &[(ProxyRouteGroup, &[&str])] = &[
    (ProxyRouteGroup::Auth, AUTH_PROXY_METHODS),
    (ProxyRouteGroup::Search, SEARCH_PROXY_METHODS),
    (ProxyRouteGroup::Catalog, CATALOG_PROXY_METHODS),
    (ProxyRouteGroup::Playlist, PLAYLIST_PROXY_METHODS),
    (ProxyRouteGroup::User, USER_PROXY_METHODS),
    (ProxyRouteGroup::Cloud, CLOUD_PROXY_METHODS),
    (ProxyRouteGroup::Recommend, RECOMMEND_PROXY_METHODS),
    (ProxyRouteGroup::Dj, DJ_PROXY_METHODS),
    (ProxyRouteGroup::Mv, MV_PROXY_METHODS),
    (ProxyRouteGroup::Comment, COMMENT_PROXY_METHODS),
];

pub(in crate::server::netease) fn proxy_route_group_for_method(
    method: &str,
) -> Option<ProxyRouteGroup> {
    PROXY_METHOD_REGISTRY
        .iter()
        .find_map(|(group, methods)| methods.contains(&method).then_some(*group))
}

#[cfg(test)]
pub(in crate::server::netease) fn proxy_method_registry(
) -> &'static [(ProxyRouteGroup, &'static [&'static str])] {
    PROXY_METHOD_REGISTRY
}

pub(super) async fn dispatch(
    client: &ApiClient,
    method: &str,
    query: &Query,
) -> Result<ApiResponse, DispatchError> {
    let Some(group) = proxy_route_group_for_method(method) else {
        return Err(DispatchError::UnsupportedRoute);
    };

    match group {
        ProxyRouteGroup::Auth => dispatch_auth_route(client, method, query).await,
        ProxyRouteGroup::Search => dispatch_search_route(client, method, query).await,
        ProxyRouteGroup::Catalog => dispatch_catalog_route(client, method, query).await,
        ProxyRouteGroup::Playlist => dispatch_playlist_route(client, method, query).await,
        ProxyRouteGroup::User => dispatch_user_route(client, method, query).await,
        ProxyRouteGroup::Cloud => dispatch_cloud_route(client, method, query).await,
        ProxyRouteGroup::Recommend => dispatch_recommend_route(client, method, query).await,
        ProxyRouteGroup::Dj => dispatch_dj_route(client, method, query).await,
        ProxyRouteGroup::Mv => dispatch_mv_route(client, method, query).await,
        ProxyRouteGroup::Comment => dispatch_comment_route(client, method, query).await,
    }
    .unwrap_or_else(|| {
        Err(DispatchError::RegistryDrift {
            method: method.to_string(),
            group,
        })
    })
}

type DispatchResult = Result<ApiResponse, DispatchError>;

fn map_ncm_response(result: Result<ApiResponse, NcmError>) -> DispatchResult {
    result.map_err(DispatchError::Ncm)
}

#[cfg(test)]
pub(in crate::server::netease) fn proxy_handler_method_names() -> Vec<&'static str> {
    let mut methods = Vec::new();
    methods.extend_from_slice(AUTH_PROXY_METHODS);
    methods.extend_from_slice(SEARCH_PROXY_METHODS);
    methods.extend_from_slice(CATALOG_PROXY_METHODS);
    methods.extend_from_slice(PLAYLIST_PROXY_METHODS);
    methods.extend_from_slice(USER_PROXY_METHODS);
    methods.extend_from_slice(CLOUD_PROXY_METHODS);
    methods.extend_from_slice(RECOMMEND_PROXY_METHODS);
    methods.extend_from_slice(DJ_PROXY_METHODS);
    methods.extend_from_slice(MV_PROXY_METHODS);
    methods.extend_from_slice(COMMENT_PROXY_METHODS);
    methods
}

fn request_option_from_query(query: &Query, crypto: CryptoType) -> RequestOption {
    RequestOption {
        crypto,
        cookie: query.cookie.clone(),
        ua: query.ua.clone(),
        proxy: query.proxy.clone(),
        real_ip: query.real_ip.clone(),
        random_cn_ip: query.random_cn_ip,
        e_r: query.e_r,
        domain: query.domain.clone(),
        check_token: false,
    }
}

pub(in crate::server::netease) fn login_qr_key_payload() -> serde_json::Value {
    json!({ "type": 3 })
}

pub(in crate::server::netease) fn login_qr_check_payload(query: &Query) -> serde_json::Value {
    json!({
        "key": query.get_or("key", ""),
        "type": 3,
    })
}

async fn request_login_qr_key(client: &ApiClient, query: &Query) -> Result<ApiResponse, NcmError> {
    client
        .request(
            "/api/login/qrcode/unikey",
            login_qr_key_payload(),
            request_option_from_query(query, CryptoType::Weapi),
        )
        .await
}

async fn request_login_qr_check(
    client: &ApiClient,
    query: &Query,
) -> Result<ApiResponse, NcmError> {
    client
        .request(
            "/api/login/qrcode/client/login",
            login_qr_check_payload(query),
            request_option_from_query(query, CryptoType::Weapi),
        )
        .await
}
