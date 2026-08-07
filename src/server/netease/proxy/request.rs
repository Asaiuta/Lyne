use actix_web::http::header::{self, HeaderMap};
use ncm_api_rs::Query;
use serde_json::Value;
use std::collections::HashMap;
use std::net::Ipv4Addr;

const MAX_USER_AGENT_LENGTH: usize = 512;

const ALLOWED_DOMAIN_OVERRIDES: &[&str] = &[
    "https://music.163.com",
    "https://interface.music.163.com",
    "https://interface3.music.163.com",
];

pub(in crate::server::netease) fn normalize_route(raw: &str) -> String {
    raw.trim_matches('/').to_string()
}

pub(in crate::server::netease) fn route_to_method(route: &str) -> String {
    route.replace('/', "_")
}

pub(in crate::server::netease) fn extract_merged_query(
    headers: &HeaderMap,
    uri_query: Option<&str>,
    body: &[u8],
    content_type: Option<&str>,
) -> Result<Query, String> {
    let mut query = Query::new();

    if let Some(cookie_header) = headers.get(header::COOKIE) {
        if let Ok(cookie) = cookie_header.to_str() {
            if !cookie.trim().is_empty() {
                query.cookie = Some(cookie.to_string());
            }
        }
    }

    if let Some(qs) = uri_query {
        if !qs.trim().is_empty() {
            let params = parse_urlencoded(qs, "query string")?;
            merge_params(&mut query.params, params);
        }
    }

    if !body.is_empty() {
        let params = parse_body_params(body, content_type)?;
        merge_params(&mut query.params, params);
    }

    apply_query_overrides(&mut query)?;

    Ok(query)
}

fn merge_params(target: &mut HashMap<String, String>, params: HashMap<String, String>) {
    for (key, value) in params {
        target.insert(key, value);
    }
}

fn parse_body_params(
    body: &[u8],
    content_type: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    let content_type = content_type.unwrap_or("");
    if content_type.contains("application/json") {
        parse_json_body(body)
    } else if content_type.contains("application/x-www-form-urlencoded") {
        let body_str =
            std::str::from_utf8(body).map_err(|e| format!("Invalid form body encoding: {}", e))?;
        parse_urlencoded(body_str, "form body")
    } else if content_type.is_empty() {
        parse_json_body(body)
    } else {
        Err(format!("Unsupported content type: {}", content_type))
    }
}

fn parse_urlencoded(input: &str, source: &str) -> Result<HashMap<String, String>, String> {
    serde_urlencoded::from_str::<HashMap<String, String>>(input)
        .map_err(|e| format!("Failed to parse {}: {}", source, e))
}

fn parse_json_body(body: &[u8]) -> Result<HashMap<String, String>, String> {
    let value: Value =
        serde_json::from_slice(body).map_err(|e| format!("Failed to parse JSON body: {}", e))?;
    let obj = value
        .as_object()
        .ok_or_else(|| "JSON body must be an object".to_string())?;
    let mut params = HashMap::new();
    for (key, value) in obj {
        params.insert(key.clone(), json_value_to_string(value));
    }
    Ok(params)
}

fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "".to_string(),
        _ => value.to_string(),
    }
}

pub(in crate::server::netease) fn apply_query_overrides(query: &mut Query) -> Result<(), String> {
    if let Some(cookie) = query.params.remove("cookie") {
        if !cookie.trim().is_empty() {
            query.cookie = Some(cookie);
        }
    }

    let camel_case_real_ip = query.params.remove("realIP");
    let snake_case_real_ip = query.params.remove("real_ip");
    if let Some(real_ip) = camel_case_real_ip.or(snake_case_real_ip) {
        let real_ip = real_ip.trim();
        if !real_ip.is_empty() {
            let real_ip = real_ip
                .parse::<Ipv4Addr>()
                .map_err(|_| "realIP override must be a valid IPv4 address".to_string())?;
            query.real_ip = Some(real_ip.to_string());
        }
    }

    if let Some(random_cn_ip) = query
        .params
        .remove("randomCNIP")
        .or_else(|| query.params.remove("random_cn_ip"))
    {
        query.random_cn_ip = parse_bool(&random_cn_ip);
    }

    query.params.remove("proxy");
    query.proxy = None;

    if let Some(ua) = query.params.remove("ua") {
        let ua = ua.trim();
        if !ua.is_empty() {
            if ua.len() > MAX_USER_AGENT_LENGTH {
                return Err(format!(
                    "ua override must be at most {} bytes",
                    MAX_USER_AGENT_LENGTH
                ));
            }
            if !ua.bytes().all(|byte| (b' '..=b'~').contains(&byte)) {
                return Err("ua override must contain printable ASCII only".to_string());
            }
            query.ua = Some(ua.to_string());
        }
    }

    if let Some(e_r) = query.params.remove("e_r") {
        query.e_r = Some(parse_bool(&e_r));
    }

    if let Some(domain) = query.params.remove("domain") {
        if !domain.trim().is_empty() {
            query.domain = Some(normalize_domain_override(&domain)?);
        }
    }

    Ok(())
}

pub(in crate::server::netease) fn normalize_domain_override(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    let url = reqwest::Url::parse(raw)
        .map_err(|_| "Domain override must be a full https URL".to_string())?;
    if url.scheme() != "https" {
        return Err("Domain override must use https".to_string());
    }
    if url.port().is_some() {
        return Err("Domain override must not include a port".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Domain override missing host".to_string())?;
    let normalized = format!("{}://{}", url.scheme(), host);

    if !ALLOWED_DOMAIN_OVERRIDES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&normalized))
    {
        return Err(format!("Domain override not allowed: {}", normalized));
    }

    Ok(normalized)
}

pub(in crate::server::netease) fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}
