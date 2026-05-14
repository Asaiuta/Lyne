use super::*;
use crate::app_database::{NcmAccountRecord, NcmAccountUpsert};
use serde_json::Value;

pub(super) async fn list_ncm_accounts(data: web::Data<Arc<AppState>>) -> HttpResponse {
    match data.app_db.list_ncm_accounts() {
        Ok((accounts, active_user_id)) => account_state_response(accounts, active_user_id),
        Err(err) => internal_server_error_response(err),
    }
}

pub(super) async fn upsert_ncm_account(
    data: web::Data<Arc<AppState>>,
    body: web::Json<UpsertNcmAccountRequest>,
) -> HttpResponse {
    let request = body.into_inner();
    if request.user_id <= 0 {
        return bad_request_response("NCM user id must be positive");
    }
    let input = NcmAccountUpsert {
        user_id: request.user_id,
        nickname: request.nickname,
        avatar_url: request.avatar_url,
        cookie: request.cookie,
        vip_type: request.vip_type,
        level: request.level,
        signin_at_ms: request.signin_at_ms,
    };

    match data.app_db.upsert_ncm_account(&input) {
        Ok(_) => list_ncm_accounts(data).await,
        Err(err) => internal_server_error_response(err),
    }
}

pub(super) async fn set_active_ncm_account(
    data: web::Data<Arc<AppState>>,
    body: web::Json<ActiveNcmAccountRequest>,
) -> HttpResponse {
    match data.app_db.set_active_ncm_account(body.user_id) {
        Ok(account) => {
            refresh_account_with_ncm(&data, &account, false).await;
            list_ncm_accounts(data).await
        }
        Err(err) => not_found_response(err),
    }
}

pub(super) async fn refresh_active_ncm_account(data: web::Data<Arc<AppState>>) -> HttpResponse {
    let account = match data.app_db.active_ncm_account() {
        Ok(Some(account)) => account,
        Ok(None) => {
            return HttpResponse::Ok()
                .json(NcmAccountStateResponse::success(Vec::new(), None));
        }
        Err(err) => {
            return internal_server_error_response(err);
        }
    };

    refresh_account_with_ncm(&data, &account, true).await;
    list_ncm_accounts(data).await
}

pub(super) async fn logout_active_ncm_account(data: web::Data<Arc<AppState>>) -> HttpResponse {
    if let Ok(Some(account)) = data.app_db.active_ncm_account() {
        if let Some(cookie) = non_empty_cookie(&account.cookie) {
            let query = Query::new().cookie(&cookie);
            if let Err(err) = data.ncm_client.logout(&query).await {
                log::warn!("NCM logout for user {} failed: {}", account.user_id, err);
            }
        }
        if let Err(err) = data.app_db.delete_ncm_account(account.user_id) {
            return internal_server_error_response(err);
        }
    }
    list_ncm_accounts(data).await
}

pub(super) async fn daily_signin_active_ncm_account(
    data: web::Data<Arc<AppState>>,
) -> HttpResponse {
    let account = match data.app_db.active_ncm_account() {
        Ok(Some(account)) => account,
        Ok(None) => {
            return account_state_response(Vec::new(), None);
        }
        Err(err) => {
            return internal_server_error_response(err);
        }
    };

    let Some(cookie) = non_empty_cookie(&account.cookie) else {
        return list_ncm_accounts(data).await;
    };

    let query = Query::new().cookie(&cookie).param("type", "0");
    match data.ncm_client.daily_signin(&query).await {
        Ok(_) => {
            if let Err(err) = data.app_db.mark_ncm_account_signed_in(account.user_id) {
                return internal_server_error_response(err);
            }
        }
        Err(err) => {
            log::warn!(
                "NCM daily signin for user {} failed: {}",
                account.user_id,
                err
            );
            return ncm_upstream_error_response(err);
        }
    }

    list_ncm_accounts(data).await
}

pub(super) async fn delete_ncm_account(
    data: web::Data<Arc<AppState>>,
    path: web::Path<NcmAccountPath>,
) -> HttpResponse {
    match data.app_db.delete_ncm_account(path.user_id) {
        Ok(()) => list_ncm_accounts(data).await,
        Err(err) => internal_server_error_response(err),
    }
}

fn account_state_response(
    accounts: Vec<NcmAccountRecord>,
    active_user_id: Option<i64>,
) -> HttpResponse {
    HttpResponse::Ok().json(NcmAccountStateResponse::success(accounts, active_user_id))
}

async fn refresh_account_with_ncm(
    data: &web::Data<Arc<AppState>>,
    account: &NcmAccountRecord,
    refresh_login_first: bool,
) {
    let Some(cookie) = non_empty_cookie(&account.cookie) else {
        return;
    };
    let query = Query::new().cookie(&cookie);

    if refresh_login_first {
        if let Err(err) = data.ncm_client.login_refresh(&query).await {
            log::warn!(
                "NCM login refresh for user {} failed: {}",
                account.user_id,
                err
            );
        }
    }

    match data.ncm_client.user_account(&query).await {
        Ok(response) => {
            if let Some(snapshot) = read_profile_snapshot(&response.body) {
                if snapshot.user_id != account.user_id {
                    log::warn!(
                        "NCM account refresh returned mismatched user id: expected {}, got {}",
                        account.user_id,
                        snapshot.user_id
                    );
                    return;
                }
                if let Err(err) = data.app_db.update_ncm_account_profile(
                    account.user_id,
                    snapshot.nickname.as_deref(),
                    snapshot.avatar_url.as_deref(),
                    snapshot.vip_type,
                    snapshot.level,
                ) {
                    log::warn!(
                        "Failed to persist refreshed NCM profile for user {}: {}",
                        account.user_id,
                        err
                    );
                }
            }
        }
        Err(err) => {
            log::warn!(
                "NCM account profile refresh for user {} failed: {}",
                account.user_id,
                err
            );
        }
    }
}

pub(super) fn read_profile_snapshot(payload: &Value) -> Option<NcmProfileSnapshot> {
    let root = payload.as_object()?;
    let data = root.get("data").and_then(Value::as_object).unwrap_or(root);
    let profile = data.get("profile").and_then(Value::as_object);
    let account = data.get("account").and_then(Value::as_object);
    let user_id = profile
        .and_then(|value| value.get("userId"))
        .and_then(Value::as_i64)
        .or_else(|| {
            account
                .and_then(|value| value.get("id"))
                .and_then(Value::as_i64)
        })?;
    Some(NcmProfileSnapshot {
        user_id,
        nickname: profile
            .and_then(|value| value.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| {
                account
                    .and_then(|value| value.get("userName"))
                    .and_then(read_non_empty_string)
            }),
        avatar_url: profile
            .and_then(|value| value.get("avatarUrl"))
            .and_then(read_non_empty_string),
        vip_type: profile
            .and_then(|value| value.get("vipType"))
            .and_then(Value::as_i64)
            .or_else(|| {
                account
                    .and_then(|value| value.get("vipType"))
                    .and_then(Value::as_i64)
            }),
        level: data.get("level").and_then(Value::as_i64),
    })
}
