use crate::db::Database;

pub const DEFAULT_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";

pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

pub fn server_base(db: &Database) -> String {
    if let Ok(env_url) = std::env::var("VAULTBASE_SERVER_URL") {
        let t = env_url.trim().trim_end_matches('/').to_string();
        if !t.is_empty() {
            return t;
        }
    }
    if let Some(cfg) = db.get_config("server_url") {
        let t = cfg.trim().trim_end_matches('/').to_string();
        if !t.is_empty() {
            return t;
        }
    }
    DEFAULT_SERVER_URL.to_string()
}

pub fn normalize_url(url: &str) -> Result<String, String> {
    let t = url.trim().trim_end_matches('/');
    if !(t.starts_with("https://") || t.starts_with("http://")) {
        return Err("url_must_be_http_s".into());
    }
    if t.len() < 12 {
        return Err("url_too_short".into());
    }
    Ok(t.to_string())
}

pub fn request(
    base: &str,
    method: &str,
    path: &str,
    bearer: Option<&str>,
    body: Option<&str>,
) -> Result<HttpResponse, String> {
    let path = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
    let url = format!("{base}{path}");

    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(25))
        .build();

    let mut req = agent.request(method, &url);
    if let Some(token) = bearer {
        req = req.set("Authorization", &format!("Bearer {token}"));
    }

    let result = match body {
        Some(payload) => req
            .set("Content-Type", "application/json")
            .send_string(payload),
        None => req.call(),
    };

    match result {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.into_string().map_err(|e| format!("read body: {e}"))?;
            Ok(HttpResponse { status, body: text })
        }
        Err(ureq::Error::Status(_code, resp)) => {
            let status = resp.status();
            let text = resp.into_string().map_err(|e| format!("read body: {e}"))?;
            Ok(HttpResponse { status, body: text })
        }
        Err(e) => Err(format!("network: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_rules() {
        assert!(normalize_url("https://api.example.com").is_ok());
        assert!(normalize_url("http://localhost:3000/").is_ok());
        assert!(normalize_url("api.example.com").is_err());
        assert!(normalize_url("ftp://x").is_err());
    }
}
