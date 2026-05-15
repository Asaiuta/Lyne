use actix_web::web;

pub(super) fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/load", web::post().to(super::load))
        .route("/play", web::post().to(super::play))
        .route("/pause", web::post().to(super::pause))
        .route("/stop", web::post().to(super::stop))
        .route("/seek", web::post().to(super::seek))
        .route("/repeat", web::post().to(super::set_repeat_mode))
        .route("/shuffle", web::post().to(super::set_shuffle_mode))
        .route("/state", web::get().to(super::get_state))
        .route("/queue_status", web::get().to(super::get_queue_status))
        .route("/volume", web::post().to(super::set_volume))
        .route("/devices", web::get().to(super::list_devices))
        .route("/configure_output", web::post().to(super::configure_output))
        .route(
            "/configure_upsampling",
            web::post().to(super::configure_upsampling),
        )
        .route(
            "/configure_resampling",
            web::post().to(super::configure_resampling),
        )
        .route(
            "/configure_normalization",
            web::post().to(super::configure_normalization),
        )
        .route("/loudness_info", web::get().to(super::get_loudness_info))
        .route("/scan_loudness", web::post().to(super::scan_track_loudness))
        .route(
            "/scan_loudness_background",
            web::post().to(super::scan_loudness_background),
        )
        .route(
            "/scan_loudness_task/{task_id}",
            web::get().to(super::get_scan_loudness_task),
        )
        .route(
            "/scan_loudness_task/{task_id}/cancel",
            web::post().to(super::cancel_scan_loudness_task),
        )
        .route("/queue_next", web::post().to(super::queue_next))
        .route("/cancel_preload", web::post().to(super::cancel_preload))
        .route("/playlist/load", web::post().to(super::load_playlist))
        .route("/load_ir", web::post().to(super::load_ir))
        .route("/unload_ir", web::post().to(super::unload_ir))
        .route("/loading_status", web::get().to(super::get_loading_status))
        .route("/ir_status", web::get().to(super::get_ir_status))
        .route(
            "/domain/analysis_tasks",
            web::get().to(super::get_recent_analysis_tasks),
        )
        .route(
            "/domain/playback_history",
            web::get().to(super::get_playback_history),
        )
        .route(
            "/domain/playback_sessions",
            web::get().to(super::get_playback_sessions),
        )
        .route("/domain/media_items", web::get().to(super::get_media_items))
        .route(
            "/domain/library/track_summaries",
            web::get().to(super::get_library_track_summaries),
        )
        .route(
            "/domain/library/tracks/{track_key}",
            web::get().to(super::get_library_track_detail),
        )
        .route(
            "/domain/library/tracks/{track_key}/cover_art",
            web::get().to(super::get_library_track_cover_art),
        )
        .route(
            "/domain/library/queue_from_query",
            web::post().to(super::replace_queue_from_library_query),
        )
        .route(
            "/domain/library/queue_from_track_keys",
            web::post().to(super::replace_queue_from_track_keys),
        )
        .route(
            "/domain/media_items/delete",
            web::post().to(super::delete_media_items),
        )
        .route(
            "/domain/media_items/metadata",
            web::post().to(super::upsert_external_media_metadata),
        )
        .route(
            "/domain/local_playlists",
            web::get().to(super::list_local_playlists),
        )
        .route(
            "/domain/local_playlists",
            web::post().to(super::create_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}",
            web::get().to(super::get_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}",
            web::patch().to(super::update_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}",
            web::delete().to(super::delete_local_playlist),
        )
        .route(
            "/domain/local_playlists/{playlist_id}/items",
            web::post().to(super::add_local_playlist_items),
        )
        .route(
            "/domain/local_playlists/{playlist_id}/items/remove",
            web::post().to(super::remove_local_playlist_items),
        )
        .route(
            "/domain/media_items/{media_id}/cover_art",
            web::get().to(super::get_media_cover_art),
        )
        .route(
            "/domain/media_items/cover_art",
            web::get().to(super::get_media_cover_art_by_query),
        )
        .route(
            "/domain/current_lyrics",
            web::get().to(super::get_current_lyrics),
        )
        .route(
            "/domain/library/roots",
            web::get().to(super::get_library_roots),
        )
        .route(
            "/domain/library/roots/{root_id}",
            web::delete().to(super::delete_library_root),
        )
        .route(
            "/domain/library/scan",
            web::post().to(super::scan_library_root),
        )
        .route(
            "/domain/library/scan_tasks/{task_id}",
            web::get().to(super::get_library_scan_task),
        )
        .route(
            "/domain/queue_snapshot",
            web::get().to(super::get_queue_snapshot_domain),
        )
        .route("/domain/queue", web::get().to(super::get_persistent_queue))
        .route(
            "/domain/queue",
            web::post().to(super::replace_persistent_queue),
        )
        .route(
            "/domain/queue/enqueue",
            web::post().to(super::enqueue_persistent_queue),
        )
        .route(
            "/domain/queue/play",
            web::post().to(super::play_from_persistent_queue),
        )
        .route(
            "/domain/queue/play_next",
            web::post().to(super::play_next_queue_entry),
        )
        .route(
            "/domain/queue/play_previous",
            web::post().to(super::play_previous_queue_entry),
        )
        .route(
            "/domain/queue/adjacent",
            web::get().to(super::get_queue_adjacent_entries),
        )
        .route(
            "/domain/queue/{entry_id}",
            web::delete().to(super::remove_persistent_queue_entry),
        )
        .route(
            "/domain/queue/clear",
            web::post().to(super::clear_persistent_queue),
        )
        .route(
            "/domain/device_config",
            web::get().to(super::get_device_config_domain),
        )
        .route(
            "/domain/dsp_configs",
            web::get().to(super::get_dsp_configs_domain),
        );
}
