use super::{inject_active_ncm_cookie, types::NeteasePath};
use crate::server::AppState;
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use std::sync::Arc;

mod registry;
mod request;
mod response;

use registry::{dispatch, DispatchError};
#[cfg(test)]
pub(super) use registry::{
    login_qr_check_payload, login_qr_key_payload, proxy_handler_method_names,
    proxy_method_registry, proxy_route_group_for_method, ProxyRouteGroup,
};
#[cfg(test)]
pub(super) use request::{apply_query_overrides, normalize_domain_override};
pub(super) use request::{extract_merged_query, normalize_route, parse_bool, route_to_method};
#[cfg(test)]
pub(super) use response::join_cookie_pairs;
use response::json_error;
pub(super) use response::{build_error_response, build_success_response};

pub(super) async fn handle_request(
    data: web::Data<Arc<AppState>>,
    req: HttpRequest,
    body: web::Bytes,
    path: web::Path<NeteasePath>,
) -> HttpResponse {
    let route = normalize_route(&path.tail);
    if route.is_empty() {
        return json_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            400,
            "Missing NCM route",
        );
    }

    let content_type = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok());

    let mut query =
        match extract_merged_query(req.headers(), req.uri().query(), &body, content_type) {
            Ok(query) => query,
            Err(err) => return json_error(actix_web::http::StatusCode::BAD_REQUEST, 400, &err),
        };
    inject_active_ncm_cookie(&data, &mut query);

    let start = std::time::Instant::now();
    let method = route_to_method(&route);
    let result = dispatch(data.ncm_client.as_ref(), &method, &query).await;

    match result {
        Ok(response) => {
            log::info!(
                "NCM {} -> {} ({:.1?})",
                route,
                response.status,
                start.elapsed()
            );
            build_success_response(response)
        }
        Err(DispatchError::UnsupportedRoute) => json_error(
            actix_web::http::StatusCode::NOT_FOUND,
            404,
            &format!("Unsupported NCM route: {}", route),
        ),
        Err(DispatchError::RegistryDrift { method, group }) => {
            log::error!(
                "NCM proxy registry drift: method {} is registered in {:?} but has no handler",
                method,
                group
            );
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                500,
                &format!(
                    "NCM proxy route is registered without a handler: {}",
                    method
                ),
            )
        }
        Err(DispatchError::Ncm(err)) => {
            log::warn!("NCM {} -> ERROR: {} ({:.1?})", route, err, start.elapsed());
            build_error_response(err)
        }
    }
}
