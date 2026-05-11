//! Bearer token authentication middleware.
//!
//! Phase 5 PR1: enforces a per-run shared secret on the localhost HTTP API.
//!
//! Validation order: `Authorization: Bearer <token>` header, then `?token=<token>`
//! query parameter (used by `<img>` cover-art URLs and any client that cannot set
//! headers). Constant-time comparison avoids leaking the token via timing.
//!
//! `OPTIONS` requests (CORS preflight) and the `/ws` upgrade path are bypassed:
//! preflight requests cannot carry credentials, and browsers cannot attach
//! `Authorization` headers to WebSocket upgrades — the WS handler runs its own
//! check using the `Sec-WebSocket-Protocol` subprotocol or query string.

use std::future::{ready, Ready};
use std::pin::Pin;
use std::sync::Arc;

use actix_web::body::{BoxBody, EitherBody};
use actix_web::dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::http::{header, Method};
use actix_web::{Error, HttpResponse};

type BoxFuture<T> = Pin<Box<dyn std::future::Future<Output = T>>>;

#[derive(Clone)]
pub struct BearerAuth {
    token: Arc<String>,
}

impl BearerAuth {
    pub fn new(token: Arc<String>) -> Self {
        Self { token }
    }
}

impl<S, B> Transform<S, ServiceRequest> for BearerAuth
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B, BoxBody>>;
    type Error = Error;
    type Transform = BearerAuthMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(BearerAuthMiddleware {
            service,
            token: Arc::clone(&self.token),
        }))
    }
}

pub struct BearerAuthMiddleware<S> {
    service: S,
    token: Arc<String>,
}

impl<S, B> Service<ServiceRequest> for BearerAuthMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B, BoxBody>>;
    type Error = Error;
    type Future = BoxFuture<Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        if is_unauthenticated_path(&req) {
            let fut = self.service.call(req);
            return Box::pin(async move {
                let res = fut.await?;
                Ok(res.map_into_left_body())
            });
        }

        if check_token(&req, &self.token) {
            let fut = self.service.call(req);
            Box::pin(async move {
                let res = fut.await?;
                Ok(res.map_into_left_body())
            })
        } else {
            let (req, _payload) = req.into_parts();
            let res = HttpResponse::Unauthorized()
                .json(serde_json::json!({
                    "status": "error",
                    "message": "unauthorized"
                }))
                .map_into_boxed_body();
            Box::pin(async move { Ok(ServiceResponse::new(req, res).map_into_right_body()) })
        }
    }
}

fn is_unauthenticated_path(req: &ServiceRequest) -> bool {
    if req.method() == Method::OPTIONS {
        return true;
    }
    // WebSocket upgrade is authenticated inside the handler — see ws_handlers::websocket.
    req.path() == "/ws"
}

fn check_token(req: &ServiceRequest, expected: &str) -> bool {
    if let Some(provided) = bearer_header(req.headers().get(header::AUTHORIZATION)) {
        return constant_time_eq(provided.as_bytes(), expected.as_bytes());
    }
    if let Some(provided) = query_token(req.uri().query()) {
        return constant_time_eq(provided.as_bytes(), expected.as_bytes());
    }
    false
}

pub fn bearer_header(value: Option<&actix_web::http::header::HeaderValue>) -> Option<&str> {
    let header = value?.to_str().ok()?;
    header.strip_prefix("Bearer ").map(str::trim)
}

pub fn query_token(query: Option<&str>) -> Option<&str> {
    let query = query?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some("token") {
            return parts.next();
        }
    }
    None
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::StatusCode;
    use actix_web::{test as actix_test, web, App, HttpResponse};

    fn make_token() -> Arc<String> {
        Arc::new("test-token-deadbeef".to_string())
    }

    async fn ok_handler() -> HttpResponse {
        HttpResponse::Ok().body("ok")
    }

    #[actix_web::test]
    async fn rejects_request_without_token() {
        let token = make_token();
        let app = actix_test::init_service(
            App::new()
                .wrap(BearerAuth::new(Arc::clone(&token)))
                .route("/state", web::get().to(ok_handler)),
        )
        .await;

        let req = actix_test::TestRequest::get().uri("/state").to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn accepts_valid_authorization_header() {
        let token = make_token();
        let app = actix_test::init_service(
            App::new()
                .wrap(BearerAuth::new(Arc::clone(&token)))
                .route("/state", web::get().to(ok_handler)),
        )
        .await;

        let req = actix_test::TestRequest::get()
            .uri("/state")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn accepts_token_query_parameter() {
        let token = make_token();
        let app = actix_test::init_service(
            App::new()
                .wrap(BearerAuth::new(Arc::clone(&token)))
                .route("/cover_art/{id}", web::get().to(ok_handler)),
        )
        .await;

        let uri = format!("/cover_art/abc?token={}", token);
        let req = actix_test::TestRequest::get().uri(&uri).to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[actix_web::test]
    async fn rejects_wrong_token() {
        let token = make_token();
        let app = actix_test::init_service(
            App::new()
                .wrap(BearerAuth::new(Arc::clone(&token)))
                .route("/state", web::get().to(ok_handler)),
        )
        .await;

        let req = actix_test::TestRequest::get()
            .uri("/state")
            .insert_header(("Authorization", "Bearer wrong-token"))
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn allows_options_preflight() {
        let token = make_token();
        let app = actix_test::init_service(
            App::new()
                .wrap(BearerAuth::new(Arc::clone(&token)))
                .route("/state", web::get().to(ok_handler)),
        )
        .await;

        let req = actix_test::TestRequest::default()
            .method(Method::OPTIONS)
            .uri("/state")
            .to_request();
        let resp = actix_test::call_service(&app, req).await;
        // The route is GET so OPTIONS will fall through to default 404 — but importantly NOT 401.
        assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn ws_path_bypasses_middleware() {
        let token = make_token();
        let app = actix_test::init_service(
            App::new()
                .wrap(BearerAuth::new(Arc::clone(&token)))
                .route("/ws", web::get().to(ok_handler)),
        )
        .await;

        let req = actix_test::TestRequest::get().uri("/ws").to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[test]
    fn constant_time_eq_handles_lengths() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"abcd", b"abc"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn bearer_header_strips_prefix() {
        let header = actix_web::http::header::HeaderValue::from_static("Bearer xyz");
        assert_eq!(bearer_header(Some(&header)), Some("xyz"));

        let no_prefix = actix_web::http::header::HeaderValue::from_static("xyz");
        assert_eq!(bearer_header(Some(&no_prefix)), None);
        assert_eq!(bearer_header(None), None);
    }

    #[test]
    fn query_token_picks_token_pair() {
        assert_eq!(query_token(Some("token=abc")), Some("abc"));
        assert_eq!(query_token(Some("foo=1&token=abc")), Some("abc"));
        assert_eq!(query_token(Some("token=abc&foo=1")), Some("abc"));
        assert_eq!(query_token(Some("foo=token")), None);
        assert_eq!(query_token(None), None);
    }
}
