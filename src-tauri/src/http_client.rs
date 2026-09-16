use std::sync::OnceLock;

static AGENT: OnceLock<ureq::Agent> = OnceLock::new();

pub fn agent() -> &'static ureq::Agent {
    AGENT.get_or_init(|| ureq::AgentBuilder::new().build())
}

pub fn get(url: &str) -> ureq::Request {
    agent().get(url)
}

pub fn post(url: &str) -> ureq::Request {
    agent().post(url)
}
