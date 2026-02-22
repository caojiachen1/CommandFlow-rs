use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub max_retry: u8,
    pub default_delay_ms: u64,
    pub failsafe_enabled: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            max_retry: 3,
            default_delay_ms: 150,
            failsafe_enabled: true,
        }
    }
}
