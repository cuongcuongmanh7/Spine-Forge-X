//! Error-to-`String` conversion shared by Tauri commands. Commands return
//! `Result<T, String>` (the boundary serializes the error to the UI), so almost
//! every fallible call ends in `.map_err(|e| e.to_string())` or a `format!` that
//! prefixes context. `ResultExt` collapses both into one call.

use std::fmt::Display;

pub(crate) trait ResultExt<T> {
    /// Convert the error to its `Display` string. Replaces `.map_err(|e| e.to_string())`.
    fn str_err(self) -> Result<T, String>;

    /// Convert the error to a `"{ctx}: {e}"` string. Replaces
    /// `.map_err(|e| format!("{ctx}: {e}"))`.
    fn context(self, ctx: &str) -> Result<T, String>;
}

impl<T, E: Display> ResultExt<T> for Result<T, E> {
    fn str_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }

    fn context(self, ctx: &str) -> Result<T, String> {
        self.map_err(|e| format!("{ctx}: {e}"))
    }
}
