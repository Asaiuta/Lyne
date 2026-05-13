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
    let mut feed = NcmHomeFeed::default();

    if request.user_id.is_some() && active_cookie.is_some() {
        let mut query = Query::new();
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.recommend_resource(&query).await {
            Ok(response) => feed.daily_picks = read_recommend_resource_cards(&response.body),
            Err(err) => push_home_feed_error(&mut feed.errors, "daily_picks", err),
        }

        let mut query = Query::new();
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.recommend_songs(&query).await {
            Ok(response) => {
                let tracks = read_daily_song_tracks(&response.body);
                feed.daily_song_covers = track_covers(&tracks);
            }
            Err(err) => push_home_feed_error(&mut feed.errors, "daily_song_covers", err),
        }

        if let Some(user_id) = request.user_id {
            let mut query = Query::new().param("uid", &user_id.to_string());
            attach_cookie(&mut query, active_cookie.as_deref());
            match data.ncm_client.likelist(&query).await {
                Ok(response) => {
                    let ids = read_likelist_ids(&response.body);
                    if !ids.is_empty() {
                        let mut detail_query = Query::new().param(
                            "ids",
                            &ids.iter()
                                .take(9)
                                .map(i64::to_string)
                                .collect::<Vec<_>>()
                                .join(","),
                        );
                        attach_cookie(&mut detail_query, active_cookie.as_deref());
                        match data.ncm_client.song_detail(&detail_query).await {
                            Ok(detail_response) => {
                                let tracks = read_song_detail_tracks(&detail_response.body);
                                feed.liked_song_covers = track_covers(&tracks);
                            }
                            Err(err) => {
                                push_home_feed_error(&mut feed.errors, "liked_song_covers", err)
                            }
                        }
                    }
                }
                Err(err) => push_home_feed_error(&mut feed.errors, "liked_song_covers", err),
            }
        }

        let mut query = Query::new();
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.personal_fm(&query).await {
            Ok(response) => {
                let tracks = read_personal_fm_tracks(&response.body);
                feed.personal_fm_covers = track_covers(&tracks);
                feed.personal_fm_preview = personal_fm_preview(&tracks);
            }
            Err(err) => push_home_feed_error(&mut feed.errors, "personal_fm", err),
        }
    }

    for playlist_id in RADAR_PLAYLIST_IDS {
        let mut query = Query::new().param("id", &playlist_id.to_string());
        attach_cookie(&mut query, active_cookie.as_deref());
        match data.ncm_client.playlist_detail(&query).await {
            Ok(response) => {
                if let Some(card) = read_radar_playlist_card(&response.body) {
                    feed.radar_playlists.push(card);
                }
            }
            Err(err) => push_home_feed_error(&mut feed.errors, "radar_playlists", err),
        }
    }

    let mut query = Query::new().param("limit", "21");
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.personalized(&query).await {
        Ok(response) => {
            feed.recommended_playlists = read_personalized_playlist_cards(&response.body)
                .into_iter()
                .filter(|item| !item.title.contains("雷达"))
                .collect();
        }
        Err(err) => push_home_feed_error(&mut feed.errors, "recommended_playlists", err),
    }

    let mut query = Query::new().param("limit", "12");
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.album_newest(&query).await {
        Ok(response) => feed.new_albums = read_newest_album_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "new_albums", err),
    }

    let mut query = Query::new().param("limit", "10");
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.top_artists(&query).await {
        Ok(response) => feed.featured_artists = read_top_artist_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "featured_artists", err),
    }

    let mut query = Query::new();
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.personalized_mv(&query).await {
        Ok(response) => feed.recommended_mvs = read_personalized_mv_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "recommended_mvs", err),
    }

    let mut query = Query::new();
    attach_cookie(&mut query, active_cookie.as_deref());
    match data.ncm_client.personalized_djprogram(&query).await {
        Ok(response) => feed.podcasts = read_personalized_dj_cards(&response.body),
        Err(err) => push_home_feed_error(&mut feed.errors, "podcasts", err),
    }

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "feed": feed
    }))
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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
        Err(err) => build_error_response(err),
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
        Err(err) => return build_error_response(err),
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

fn push_home_feed_error(errors: &mut Vec<NcmHomeFeedError>, section: &'static str, err: NcmError) {
    let message = err.to_string();
    log::warn!("NCM home feed section {} failed: {}", section, message);
    errors.push(NcmHomeFeedError {
        section: section.to_string(),
        message,
    });
}
