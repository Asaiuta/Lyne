use std::borrow::Cow;

use crate::decoder::{HttpAddressPolicy, HttpCredentials};

/// HTTP credentials and destination trust carried as one source-open contract.
#[derive(Clone, Debug, Default)]
pub struct MediaSourceAccess {
    credentials: Option<HttpCredentials>,
    address_policy: HttpAddressPolicy,
    source_key: Option<String>,
}

impl MediaSourceAccess {
    pub fn public_only() -> Self {
        Self::default()
    }

    pub(crate) fn trusted_origin(
        origin: &str,
        credentials: Option<HttpCredentials>,
        source_key: &str,
    ) -> Result<Self, String> {
        let address_policy = HttpAddressPolicy::trusted_origin(origin)
            .map_err(|error| format!("Invalid trusted media origin: {error}"))?;
        Ok(Self {
            credentials,
            address_policy,
            source_key: Some(source_key.to_string()),
        })
    }

    pub(crate) fn credentials(&self) -> Option<&HttpCredentials> {
        self.credentials.as_ref()
    }

    pub(crate) fn address_policy(&self) -> &HttpAddressPolicy {
        &self.address_policy
    }

    pub(crate) fn has_credentials(&self) -> bool {
        self.credentials.is_some()
    }

    pub(crate) fn cache_key<'a>(&self, path: &'a str) -> Cow<'a, str> {
        match self.source_key.as_deref() {
            Some(source_key) => Cow::Owned(format!(
                "lyne-webdav-cache-v1:{}:{source_key}{path}",
                source_key.len()
            )),
            None => Cow::Borrowed(path),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_access_never_carries_credentials_by_default() {
        let access = MediaSourceAccess::public_only();
        assert!(access.credentials().is_none());
        assert!(!access.has_credentials());
    }

    #[test]
    fn trusted_access_rejects_non_http_origins() {
        assert!(MediaSourceAccess::trusted_origin("file:///music", None, "nas").is_err());
    }

    #[test]
    fn cache_keys_separate_configured_sources_for_the_same_url() {
        let path = "https://nas.example.test/dav/song.flac";
        let first =
            MediaSourceAccess::trusted_origin("https://nas.example.test", None, "first").unwrap();
        let second =
            MediaSourceAccess::trusted_origin("https://nas.example.test", None, "second").unwrap();

        assert_eq!(MediaSourceAccess::public_only().cache_key(path), path);
        assert_ne!(first.cache_key(path), second.cache_key(path));
        assert_ne!(
            first.cache_key(path),
            MediaSourceAccess::public_only().cache_key(&format!("{path}#lyne-source=first"))
        );
    }
}
