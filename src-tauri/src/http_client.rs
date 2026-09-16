use std::sync::OnceLock;

static AGENT: OnceLock<ureq::Agent> = OnceLock::new();

pub fn agent() -> &'static ureq::Agent {
    AGENT.get_or_init(|| {
        let builder = ureq::AgentBuilder::new();
        // 7rn: SPKI-пиннинг корней LE для боевого сервера. При
        // переопределённом URL (self-hosted/стенд) pinned_client_config()
        // вернёт None — остаётся дефолтный TLS ureq без пинов.
        let builder = match crate::tls_pins::pinned_client_config() {
            Some(cfg) => builder.tls_config(cfg),
            None => builder,
        };
        builder.build()
    })
}

pub fn get(url: &str) -> ureq::Request {
    agent().get(url)
}

pub fn post(url: &str) -> ureq::Request {
    agent().post(url)
}
