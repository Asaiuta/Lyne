use super::*;

const RADAR_PLAYLIST_IDS: &[i64] = &[
    3136952023, 8402996200, 5320167908, 5327906368, 5362359247, 5300458264, 5341776086,
];

pub(super) async fn get_ncm_home_feed(
    data: web::Data<Arc<AppState>>,
    body: web::Json<HomeFeedRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.user_id.is_some_and(|user_id| user_id <= 0) {
        return bad_request_response("NCM user id must be positive");
    }

    let active_cookie = active_ncm_cookie(&data);
    let client = Arc::clone(&data.ncm_client);
    let authenticated = request.user_id.is_some() && active_cookie.is_some();

    let (
        daily_picks,
        daily_song_covers,
        liked_song_covers,
        personal_fm,
        radar_playlists,
        recommended_playlists,
        new_albums,
        featured_artists,
        recommended_mvs,
        podcasts,
    ) = tokio::join!(
        fetch_home_daily_picks(Arc::clone(&client), active_cookie.clone(), authenticated),
        fetch_home_daily_song_covers(Arc::clone(&client), active_cookie.clone(), authenticated),
        fetch_home_liked_song_covers(
            Arc::clone(&client),
            active_cookie.clone(),
            request.user_id,
            authenticated,
        ),
        fetch_home_personal_fm(Arc::clone(&client), active_cookie.clone(), authenticated),
        fetch_home_radar_playlists(Arc::clone(&client), active_cookie.clone()),
        fetch_home_recommended_playlists(Arc::clone(&client), active_cookie.clone()),
        fetch_home_new_albums(Arc::clone(&client), active_cookie.clone()),
        fetch_home_featured_artists(Arc::clone(&client), active_cookie.clone()),
        fetch_home_recommended_mvs(Arc::clone(&client), active_cookie.clone()),
        fetch_home_podcasts(client, active_cookie),
    );

    let mut errors = Vec::new();
    push_home_feed_result_error(&mut errors, "daily_picks", &daily_picks);
    push_home_feed_result_error(&mut errors, "daily_song_covers", &daily_song_covers);
    push_home_feed_result_error(&mut errors, "liked_song_covers", &liked_song_covers);
    push_home_feed_result_error(&mut errors, "personal_fm", &personal_fm);
    push_home_feed_errors(&mut errors, "radar_playlists", &radar_playlists.errors);
    push_home_feed_result_error(&mut errors, "recommended_playlists", &recommended_playlists);
    push_home_feed_result_error(&mut errors, "new_albums", &new_albums);
    push_home_feed_result_error(&mut errors, "featured_artists", &featured_artists);
    push_home_feed_result_error(&mut errors, "recommended_mvs", &recommended_mvs);
    push_home_feed_result_error(&mut errors, "podcasts", &podcasts);

    let feed = NcmHomeFeed {
        daily_picks: daily_picks.unwrap_or_default(),
        daily_song_covers: daily_song_covers.unwrap_or_default(),
        liked_song_covers: liked_song_covers.unwrap_or_default(),
        personal_fm_covers: personal_fm
            .as_ref()
            .map(|result| result.covers.clone())
            .unwrap_or_default(),
        personal_fm_preview: personal_fm
            .as_ref()
            .ok()
            .and_then(|result| result.preview.clone()),
        radar_playlists: radar_playlists.cards,
        recommended_playlists: recommended_playlists.unwrap_or_default(),
        new_albums: new_albums.unwrap_or_default(),
        featured_artists: featured_artists.unwrap_or_default(),
        recommended_mvs: recommended_mvs.unwrap_or_default(),
        podcasts: podcasts.unwrap_or_default(),
        errors,
    };

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "feed": feed
    }))
}

#[derive(Clone, Debug, Default)]
struct HomePersonalFmSection {
    covers: Vec<NcmHomeTrackCover>,
    preview: Option<NcmHomePersonalFmPreview>,
}

#[derive(Clone, Debug, Default)]
struct HomeRadarSection {
    cards: Vec<NcmHomeFeedCard>,
    errors: Vec<String>,
}

fn query_with_cookie(cookie: Option<String>) -> Query {
    let mut query = Query::new();
    attach_cookie(&mut query, cookie.as_deref());
    query
}

async fn fetch_home_daily_picks(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
    authenticated: bool,
) -> Result<Vec<NcmHomeFeedCard>, NcmError> {
    if !authenticated {
        return Ok(Vec::new());
    }
    let query = query_with_cookie(cookie);
    client
        .recommend_resource(&query)
        .await
        .map(|response| read_recommend_resource_cards(&response.body))
}

async fn fetch_home_daily_song_covers(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
    authenticated: bool,
) -> Result<Vec<NcmHomeTrackCover>, NcmError> {
    if !authenticated {
        return Ok(Vec::new());
    }
    let query = query_with_cookie(cookie);
    client.recommend_songs(&query).await.map(|response| {
        let tracks = read_daily_song_tracks(&response.body);
        track_covers(&tracks)
    })
}

async fn fetch_home_liked_song_covers(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
    user_id: Option<i64>,
    authenticated: bool,
) -> Result<Vec<NcmHomeTrackCover>, NcmError> {
    let Some(user_id) = user_id else {
        return Ok(Vec::new());
    };
    if !authenticated {
        return Ok(Vec::new());
    }

    let mut query = Query::new().param("uid", &user_id.to_string());
    attach_cookie(&mut query, cookie.as_deref());
    let response = client.likelist(&query).await?;
    let ids = read_likelist_ids(&response.body);
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut detail_query = Query::new().param(
        "ids",
        &ids.iter()
            .take(9)
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(","),
    );
    attach_cookie(&mut detail_query, cookie.as_deref());
    let detail_response = client.song_detail(&detail_query).await?;
    let tracks = read_song_detail_tracks(&detail_response.body);
    Ok(track_covers(&tracks))
}

async fn fetch_home_personal_fm(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
    authenticated: bool,
) -> Result<HomePersonalFmSection, NcmError> {
    if !authenticated {
        return Ok(HomePersonalFmSection::default());
    }
    let query = query_with_cookie(cookie);
    client.personal_fm(&query).await.map(|response| {
        let tracks = read_personal_fm_tracks(&response.body);
        HomePersonalFmSection {
            covers: track_covers(&tracks),
            preview: personal_fm_preview(&tracks),
        }
    })
}

async fn fetch_home_radar_playlists(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
) -> HomeRadarSection {
    let mut cards = Vec::new();
    let mut errors = Vec::new();
    let results = tokio::join!(
        fetch_home_radar_playlist(Arc::clone(&client), cookie.clone(), RADAR_PLAYLIST_IDS[0]),
        fetch_home_radar_playlist(Arc::clone(&client), cookie.clone(), RADAR_PLAYLIST_IDS[1]),
        fetch_home_radar_playlist(Arc::clone(&client), cookie.clone(), RADAR_PLAYLIST_IDS[2]),
        fetch_home_radar_playlist(Arc::clone(&client), cookie.clone(), RADAR_PLAYLIST_IDS[3]),
        fetch_home_radar_playlist(Arc::clone(&client), cookie.clone(), RADAR_PLAYLIST_IDS[4]),
        fetch_home_radar_playlist(Arc::clone(&client), cookie.clone(), RADAR_PLAYLIST_IDS[5]),
        fetch_home_radar_playlist(client, cookie, RADAR_PLAYLIST_IDS[6]),
    );

    for result in [
        results.0, results.1, results.2, results.3, results.4, results.5, results.6,
    ] {
        match result {
            Ok(Some(card)) => cards.push(card),
            Ok(None) => {}
            Err(err) => errors.push(err.to_string()),
        }
    }
    HomeRadarSection { cards, errors }
}

async fn fetch_home_radar_playlist(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
    playlist_id: i64,
) -> Result<Option<NcmHomeFeedCard>, NcmError> {
    let mut query = Query::new().param("id", &playlist_id.to_string());
    attach_cookie(&mut query, cookie.as_deref());
    client
        .playlist_detail(&query)
        .await
        .map(|response| read_radar_playlist_card(&response.body))
}

async fn fetch_home_recommended_playlists(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
) -> Result<Vec<NcmHomeFeedCard>, NcmError> {
    let mut query = Query::new().param("limit", "21");
    attach_cookie(&mut query, cookie.as_deref());
    client.personalized(&query).await.map(|response| {
        read_personalized_playlist_cards(&response.body)
            .into_iter()
            .filter(|item| !item.title.contains("雷达"))
            .collect()
    })
}

async fn fetch_home_new_albums(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
) -> Result<Vec<NcmHomeFeedCard>, NcmError> {
    let mut query = Query::new().param("limit", "12");
    attach_cookie(&mut query, cookie.as_deref());
    client
        .album_newest(&query)
        .await
        .map(|response| read_newest_album_cards(&response.body))
}

async fn fetch_home_featured_artists(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
) -> Result<Vec<NcmHomeFeedCard>, NcmError> {
    let mut query = Query::new().param("limit", "10");
    attach_cookie(&mut query, cookie.as_deref());
    client
        .top_artists(&query)
        .await
        .map(|response| read_top_artist_cards(&response.body))
}

async fn fetch_home_recommended_mvs(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
) -> Result<Vec<NcmHomeFeedCard>, NcmError> {
    let query = query_with_cookie(cookie);
    client
        .personalized_mv(&query)
        .await
        .map(|response| read_personalized_mv_cards(&response.body))
}

async fn fetch_home_podcasts(
    client: Arc<ncm_api_rs::ApiClient>,
    cookie: Option<String>,
) -> Result<Vec<NcmHomeFeedCard>, NcmError> {
    let query = query_with_cookie(cookie);
    client
        .personalized_djprogram(&query)
        .await
        .map(|response| read_personalized_dj_cards(&response.body))
}

pub(super) async fn list_ncm_discover_playlists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverPlaylistsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let kind = request
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("normal");
    if kind != "normal" && kind != "hq" {
        return bad_request_response("NCM discover playlist kind must be normal or hq");
    }

    let cat = request
        .cat
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("全部歌单");
    let limit = request.limit.filter(|value| *value > 0).unwrap_or(50);
    let offset = request.offset.filter(|value| *value >= 0).unwrap_or(0);
    let mut query = Query::new()
        .param("cat", cat)
        .param("limit", &limit.to_string());
    if kind == "hq" {
        if let Some(before) = request.before.filter(|value| *value > 0) {
            query = query.param("before", &before.to_string());
        }
    } else {
        query = query
            .param("order", "hot")
            .param("offset", &offset.to_string());
    }
    inject_active_ncm_cookie(&data, &mut query);

    let result = if kind == "hq" {
        data.ncm_client.top_playlist_highquality(&query).await
    } else {
        data.ncm_client.top_playlist(&query).await
    };

    match result {
        Ok(response) => {
            let items = read_discover_playlist_cards(&response.body);
            let has_more = read_page_has_more(&response.body, limit, offset, items.len());
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "items": items,
                "has_more": has_more
            }))
        }
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_discover_albums(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverAlbumsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let area = request
        .area
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("ALL");
    let limit = request.limit.filter(|value| *value > 0).unwrap_or(50);
    let offset = request.offset.filter(|value| *value >= 0).unwrap_or(0);
    let mut query = Query::new()
        .param("area", area)
        .param("limit", &limit.to_string())
        .param("offset", &offset.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.album_new(&query).await {
        Ok(response) => {
            let items = read_discover_album_cards(&response.body);
            let has_more = read_page_has_more(&response.body, limit, offset, items.len());
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "items": items,
                "has_more": has_more
            }))
        }
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_discover_artists(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverArtistsRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    let limit = request.limit.filter(|value| *value > 0).unwrap_or(50);
    let offset = request.offset.filter(|value| *value >= 0).unwrap_or(0);
    let mut query = Query::new()
        .param("type", &request.artist_type.unwrap_or(-1).to_string())
        .param("area", &request.area.unwrap_or(-1).to_string())
        .param("limit", &limit.to_string())
        .param("offset", &offset.to_string());
    if let Some(initial) = request.initial.as_ref().and_then(discover_initial_param) {
        query = query.param("initial", &initial);
    }
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.artist_list(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "items": read_discover_artist_cards(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_discover_toplists(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let mut query = Query::new();
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.toplist_detail(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "toplists": read_discover_toplists(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn list_ncm_discover_songs(
    data: web::Data<Arc<AppState>>,
    body: web::Json<DiscoverSongsRequest>,
) -> HttpResponse {
    let song_type = body.song_type.unwrap_or(0);
    if !matches!(song_type, 0 | 7 | 96 | 16 | 8) {
        return bad_request_response("NCM discover song type is invalid");
    }

    let mut query = Query::new().param("type", &song_type.to_string());
    inject_active_ncm_cookie(&data, &mut query);

    match data.ncm_client.top_song(&query).await {
        Ok(response) => HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "tracks": read_top_song_tracks(&response.body)
        })),
        Err(err) => ncm_upstream_error_response(err),
    }
}

pub(super) async fn get_ncm_discover_playlist_categories(
    data: web::Data<Arc<AppState>>,
) -> HttpResponse {
    let mut cat_query = Query::new();
    let mut hq_query = Query::new();
    inject_active_ncm_cookie(&data, &mut cat_query);
    inject_active_ncm_cookie(&data, &mut hq_query);

    let (cat_result, hq_result) = tokio::join!(
        data.ncm_client.playlist_catlist(&cat_query),
        data.ncm_client.playlist_highquality_tags(&hq_query)
    );

    let cat_response = match cat_result {
        Ok(response) => response,
        Err(err) => return ncm_upstream_error_response(err),
    };
    let hq_body = match hq_result {
        Ok(response) => response.body,
        Err(err) => {
            log::warn!("NCM discover highquality tags failed: {}", err);
            serde_json::json!({})
        }
    };

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "categories": read_discover_playlist_categories(&cat_response.body, &hq_body)
    }))
}

fn push_home_feed_result_error<T>(
    errors: &mut Vec<NcmHomeFeedError>,
    section: &'static str,
    result: &Result<T, NcmError>,
) {
    if let Err(err) = result {
        push_home_feed_error_message(errors, section, err.to_string());
    }
}

fn push_home_feed_errors(
    errors: &mut Vec<NcmHomeFeedError>,
    section: &'static str,
    messages: &[String],
) {
    for message in messages {
        push_home_feed_error_message(errors, section, message.clone());
    }
}

fn push_home_feed_error_message(
    errors: &mut Vec<NcmHomeFeedError>,
    section: &'static str,
    message: String,
) {
    log::warn!("NCM home feed section {} failed: {}", section, message);
    errors.push(NcmHomeFeedError {
        section: section.to_string(),
        message,
    });
}
