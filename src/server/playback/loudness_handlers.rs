use super::*;
use actix_web::{web, HttpResponse};
use std::sync::atomic::Ordering;

pub(super) async fn get_loudness_info(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let player = data.player.lock();
    let info = player.get_loudness_info();

    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "loudness": {
            "integrated_lufs": info.integrated_lufs,
            "short_term_lufs": info.short_term_lufs,
            "momentary_lufs": info.momentary_lufs,
            "loudness_range": info.loudness_range,
            "true_peak_dbtp": info.true_peak_dbtp,
            "current_gain_db": info.current_gain_db,
            "target_gain_db": info.target_gain_db,
        }
    }))
}

pub(super) async fn scan_track_loudness(
    data: web::Data<Arc<AppState>>,
    body: web::Json<LoadRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return bad_request_response(e),
    };

    if let Some(track_loudness) = try_get_cached_loudness(&data, &path) {
        return HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "source": "cache",
            "track_loudness": track_loudness_to_json(&track_loudness)
        }));
    }

    let credentials = {
        let cfg = data.webdav_config.lock();
        cfg.http_credentials()
    };

    let path_for_job = path.clone();
    let credentials_for_job = credentials.clone();

    let result = run_analysis_job(&data, move |cancel_token| {
        analyze_track_loudness(path_for_job, credentials_for_job, cancel_token)
    })
    .await;

    match result {
        Ok(track_loudness) => {
            try_store_loudness(&data, &track_loudness);
            HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "source": "fresh",
                "track_loudness": track_loudness_to_json(&track_loudness)
            }))
        }
        Err(e) => analysis_error_response(&e),
    }
}

pub(super) async fn scan_loudness_background(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ScanBackgroundRequest>,
) -> HttpResponse {
    let path = match validate_path(&body.path) {
        Ok(p) => p,
        Err(e) => return bad_request_response(e),
    };
    let store = body.store.unwrap_or(true);

    if data.analysis.analysis_semaphore.available_permits() == 0 {
        return too_many_requests_response("Too many scan tasks in progress, please retry later");
    }

    cleanup_scan_tasks(&data);

    let task_id = data
        .analysis
        .scan_task_counter
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let now = now_epoch_secs();
    let initial_task = ScanTaskRecord {
        status: "queued".to_string(),
        created_at_epoch_secs: now,
        updated_at_epoch_secs: now,
        result: None,
        error: None,
    };
    data.analysis
        .scan_tasks
        .lock()
        .insert(task_id, initial_task.clone());
    upsert_scan_task_record(&data, task_id, &path, &initial_task, store);
    let task_cancel_token = AnalysisCancelToken::new();
    register_scan_task_cancel(&data, task_id, task_cancel_token.clone());

    let data_for_task = data.clone();
    let path_for_task = path.clone();
    actix_rt::spawn(async move {
        let should_start = {
            let mut tasks = data_for_task.analysis.scan_tasks.lock();
            if let Some(task) = tasks.get_mut(&task_id) {
                if task.status == "canceled" {
                    false
                } else {
                    task.status = "running".to_string();
                    task.updated_at_epoch_secs = now_epoch_secs();
                    let snapshot = task.clone();
                    upsert_scan_task_record(
                        &data_for_task,
                        task_id,
                        &path_for_task,
                        &snapshot,
                        store,
                    );
                    true
                }
            } else {
                false
            }
        };
        if !should_start {
            remove_scan_task_cancel(&data_for_task, task_id);
            return;
        }

        if task_is_canceled(&data_for_task, task_id) {
            remove_scan_task_cancel(&data_for_task, task_id);
            return;
        }

        if let Some(track_loudness) = try_get_cached_loudness(&data_for_task, &path_for_task) {
            if !task_is_canceled(&data_for_task, task_id) {
                if let Some(task) = data_for_task.analysis.scan_tasks.lock().get_mut(&task_id) {
                    task.status = "success".to_string();
                    task.result = Some(track_loudness_to_json(&track_loudness));
                    task.updated_at_epoch_secs = now_epoch_secs();
                    let snapshot = task.clone();
                    upsert_scan_task_record(
                        &data_for_task,
                        task_id,
                        &path_for_task,
                        &snapshot,
                        store,
                    );
                }
            }
            remove_scan_task_cancel(&data_for_task, task_id);
            return;
        }

        let path_for_analysis = path_for_task.clone();
        let result =
            run_analysis_job_with_token(&data_for_task, task_cancel_token, move |cancel_token| {
                analyze_track_loudness(path_for_analysis, None, cancel_token)
            })
            .await;

        match result {
            Ok(track_loudness) => {
                if store {
                    try_store_loudness(&data_for_task, &track_loudness);
                }
                if !task_is_canceled(&data_for_task, task_id) {
                    if let Some(task) = data_for_task.analysis.scan_tasks.lock().get_mut(&task_id) {
                        task.status = "success".to_string();
                        task.result = Some(track_loudness_to_json(&track_loudness));
                        task.updated_at_epoch_secs = now_epoch_secs();
                        let snapshot = task.clone();
                        upsert_scan_task_record(
                            &data_for_task,
                            task_id,
                            &path_for_task,
                            &snapshot,
                            store,
                        );
                    }
                }
            }
            Err(e) => {
                if !task_is_canceled(&data_for_task, task_id) {
                    if let Some(task) = data_for_task.analysis.scan_tasks.lock().get_mut(&task_id) {
                        task.status = if is_analysis_timeout_error(&e) {
                            "timeout".to_string()
                        } else if is_analysis_cancelled_error(&e) {
                            "canceled".to_string()
                        } else {
                            "error".to_string()
                        };
                        task.error = Some(e);
                        task.updated_at_epoch_secs = now_epoch_secs();
                        let snapshot = task.clone();
                        upsert_scan_task_record(
                            &data_for_task,
                            task_id,
                            &path_for_task,
                            &snapshot,
                            store,
                        );
                    }
                }
            }
        }

        remove_scan_task_cancel(&data_for_task, task_id);
        cleanup_scan_tasks(&data_for_task);
    });

    HttpResponse::Accepted().json(serde_json::json!({
        "status": "success",
        "task_id": task_id,
        "path": path
    }))
}

pub(super) async fn get_scan_loudness_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    cleanup_scan_tasks(&data);

    let task_id = path.task_id;
    let tasks = data.analysis.scan_tasks.lock();
    if let Some(task) = tasks.get(&task_id) {
        HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "task_id": task_id,
            "task": task
        }))
    } else {
        drop(tasks);
        match data.app_db.get_analysis_task(task_id) {
            Ok(Some(task)) => HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task_id,
                "task": task
            })),
            Ok(None) => not_found_response("Scan task not found"),
            Err(e) => internal_server_error_response(e),
        }
    }
}

pub(super) async fn cancel_scan_loudness_task(
    data: web::Data<Arc<AppState>>,
    path: web::Path<ScanTaskPath>,
) -> HttpResponse {
    cleanup_scan_tasks(&data);

    let task_id = path.task_id;
    cancel_scan_task_token(&data, task_id);
    let mut tasks = data.analysis.scan_tasks.lock();
    if let Some(task) = tasks.get_mut(&task_id) {
        match task.status.as_str() {
            "queued" | "running" => {
                task.status = "canceled".to_string();
                task.error = Some("Canceled by client".to_string());
                task.updated_at_epoch_secs = now_epoch_secs();
                let snapshot = task.clone();
                let source_path = data
                    .app_db
                    .get_analysis_task(task_id)
                    .ok()
                    .flatten()
                    .map(|task| task.source_path)
                    .unwrap_or_default();
                upsert_scan_task_record(&data, task_id, &source_path, &snapshot, true);
                HttpResponse::Ok().json(serde_json::json!({
                    "status": "success",
                    "task_id": task_id,
                    "message": "Scan task canceled"
                }))
            }
            _ => HttpResponse::Ok().json(serde_json::json!({
                "status": "success",
                "task_id": task_id,
                "message": "Task already finished"
            })),
        }
    } else {
        not_found_response("Scan task not found")
    }
}
