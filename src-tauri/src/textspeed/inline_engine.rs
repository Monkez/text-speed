use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use rdev::{listen, simulate, Event, EventType, Key};
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder,
};

use super::{
    ai, clipboard,
    inline::{parse_inline_buffer, InlineExecution, InlineMatch},
    settings::AppSettings,
};

const INLINE_RUNNING_MARKER: &str = "[TextSpeed running...]";
const CLIPBOARD_CLEANUP_DELAY_MS: u64 = 2_000;
const CLIPBOARD_WRITE_SETTLE_MS: u64 = 140;
const SELECT_ALL_SETTLE_MS: u64 = 80;
const PASTE_SETTLE_MS: u64 = 180;
const FLOATING_WINDOW_WIDTH: f64 = 340.0;
const FLOATING_WINDOW_HEIGHT: f64 = 330.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyEventPayload {
    action: &'static str,
    hotkey: String,
}

#[derive(Clone)]
pub struct InlineRuntime {
    enabled: Arc<AtomicBool>,
    suppress: Arc<AtomicBool>,
    started: Arc<AtomicBool>,
    shift_down: Arc<AtomicBool>,
    ctrl_down: Arc<AtomicBool>,
    alt_down: Arc<AtomicBool>,
    meta_down: Arc<AtomicBool>,
    pending_inline_attempt: Arc<Mutex<Option<InlineMatch>>>,
    status: Arc<Mutex<Vec<String>>>,
    buffer: Arc<Mutex<String>>,
    last_mouse_pos: Arc<Mutex<(f64, f64)>>,
}

impl InlineRuntime {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            suppress: Arc::new(AtomicBool::new(false)),
            started: Arc::new(AtomicBool::new(false)),
            shift_down: Arc::new(AtomicBool::new(false)),
            ctrl_down: Arc::new(AtomicBool::new(false)),
            alt_down: Arc::new(AtomicBool::new(false)),
            meta_down: Arc::new(AtomicBool::new(false)),
            pending_inline_attempt: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(vec!["Inline hook ready".to_string()])),
            buffer: Arc::new(Mutex::new(String::new())),
            last_mouse_pos: Arc::new(Mutex::new((320.0, 240.0))),
        }
    }

    pub fn start(&self, settings: Arc<Mutex<AppSettings>>, app: AppHandle) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }

        let runtime = self.clone();
        thread::spawn(move || {
            runtime.set_status("Inline hook listening");
            let callback_runtime = runtime.clone();
            let callback = move |event: Event| {
                callback_runtime.handle_event(event, settings.clone(), app.clone());
            };

            if let Err(error) = listen(callback) {
                runtime.set_status(format!("Inline hook error: {error:?}"));
            }
        });
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        self.set_status(if enabled {
            "Inline hook enabled"
        } else {
            "Inline hook disabled"
        });
    }

    pub fn status(&self) -> Vec<String> {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| vec!["Inline hook status unavailable".to_string()])
    }

    fn handle_event(&self, event: Event, settings: Arc<Mutex<AppSettings>>, app: AppHandle) {
        let key = match event.event_type {
            EventType::ButtonPress(_) => {
                if let Ok(mut buffer) = self.buffer.lock() {
                    buffer.clear();
                }
                return;
            }
            EventType::MouseMove { x, y } => {
                if let Ok(mut pos) = self.last_mouse_pos.lock() {
                    *pos = (x, y);
                }
                return;
            }
            EventType::KeyPress(Key::ShiftLeft | Key::ShiftRight) => {
                self.shift_down.store(true, Ordering::SeqCst);
                return;
            }
            EventType::KeyPress(Key::ControlLeft | Key::ControlRight) => {
                self.ctrl_down.store(true, Ordering::SeqCst);
                return;
            }
            EventType::KeyPress(Key::Alt | Key::AltGr) => {
                self.alt_down.store(true, Ordering::SeqCst);
                return;
            }
            EventType::KeyPress(Key::MetaLeft | Key::MetaRight) => {
                self.meta_down.store(true, Ordering::SeqCst);
                return;
            }
            EventType::KeyRelease(Key::ShiftLeft | Key::ShiftRight) => {
                self.shift_down.store(false, Ordering::SeqCst);
                let mut pending_parsed = None;
                if let Ok(mut pending) = self.pending_inline_attempt.lock() {
                    pending_parsed = pending.take();
                }
                if let Some(parsed) = pending_parsed {
                    self.start_inline_attempt(format!("buffer //{}", parsed.command), settings);
                }
                return;
            }
            EventType::KeyRelease(Key::ControlLeft | Key::ControlRight) => {
                self.ctrl_down.store(false, Ordering::SeqCst);
                return;
            }
            EventType::KeyRelease(Key::Alt | Key::AltGr) => {
                self.alt_down.store(false, Ordering::SeqCst);
                return;
            }
            EventType::KeyRelease(Key::MetaLeft | Key::MetaRight) => {
                self.meta_down.store(false, Ordering::SeqCst);
                return;
            }
            EventType::KeyRelease(Key::Slash) => {
                if self.maybe_handle_hotkey(Key::Slash, &settings, &app) {
                    return;
                }

                let mut pending_parsed = None;
                if let Ok(mut pending) = self.pending_inline_attempt.lock() {
                    pending_parsed = pending.take();
                }
                if let Some(parsed) = pending_parsed {
                    self.start_inline_attempt(format!("buffer //{}", parsed.command), settings);
                    return;
                }

                let should_probe = self
                    .buffer
                    .lock()
                    .map(|buffer| should_probe_inline_from_buffer(&buffer))
                    .unwrap_or(false);
                if should_probe {
                    self.start_inline_attempt("slash probe".to_string(), settings);
                }
                return;
            }
            EventType::KeyRelease(key) => {
                if self.maybe_handle_hotkey(key, &settings, &app) {
                    return;
                }

                let mut pending_parsed = None;
                if let Ok(mut pending) = self.pending_inline_attempt.lock() {
                    pending_parsed = pending.take();
                }
                if let Some(parsed) = pending_parsed {
                    self.start_inline_attempt(format!("buffer //{}", parsed.command), settings);
                }
                return;
            }
            EventType::KeyPress(key) => key,
            _ => return,
        };

        if self.suppress.load(Ordering::SeqCst) || !self.enabled.load(Ordering::SeqCst) {
            return;
        }

        let shift_down = self.shift_down.load(Ordering::SeqCst);
        let ctrl_down = self.ctrl_down.load(Ordering::SeqCst);
        let alt_down = self.alt_down.load(Ordering::SeqCst);
        let meta_down = self.meta_down.load(Ordering::SeqCst);
        if ctrl_down || alt_down || meta_down {
            return;
        }

        let mut buffer = match self.buffer.lock() {
            Ok(buffer) => buffer,
            Err(_) => return,
        };

        match key {
            Key::Backspace => {
                buffer.pop();
                return;
            }
            Key::Escape
            | Key::Return
            | Key::UpArrow
            | Key::DownArrow
            | Key::LeftArrow
            | Key::RightArrow
            | Key::Home
            | Key::End
            | Key::PageUp
            | Key::PageDown
            | Key::Tab => {
                buffer.clear();
                return;
            }
            Key::Space => buffer.push(' '),
            _ => {
                let Some(text) = normalized_key_text(key, event.name.as_deref(), shift_down) else {
                    return;
                };
                buffer.push(text);
            }
        }

        if buffer.chars().count() > 600 {
            *buffer = buffer
                .chars()
                .rev()
                .take(600)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
        }

        if let Some(parsed) = parse_inline_buffer(&buffer) {
            buffer.clear();
            drop(buffer);
            if let Ok(mut pending) = self.pending_inline_attempt.lock() {
                *pending = Some(parsed);
            }
        }
    }

    fn start_inline_attempt(&self, trigger: String, settings: Arc<Mutex<AppSettings>>) {
        if !self.enabled.load(Ordering::SeqCst) {
            return;
        }

        let settings_snapshot = match settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => return,
        };

        if !settings_snapshot.inline_enabled {
            return;
        }

        if self
            .suppress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        if let Ok(mut buffer) = self.buffer.lock() {
            buffer.clear();
        }

        let runtime = self.clone();
        thread::spawn(move || {
            runtime.set_status(format!("--- Inline Triggered: {trigger} ---"));
            thread::sleep(Duration::from_millis(150));

            let extraction =
                match extract_inline_command_from_focused_text(|msg| runtime.set_status(msg)) {
                    Ok(ext) => ext,
                    Err(reason) => {
                        let _ = tap_key(Key::RightArrow);
                        runtime.set_status(format!("Extract failed: {}", reason));
                        runtime.suppress.store(false, Ordering::SeqCst);
                        return;
                    }
                };

            let true_parsed = extraction.parsed;
            runtime.set_status(format!("Parsed command: //{}", true_parsed.command));

            let Some(command) = settings_snapshot
                .commands
                .iter()
                .find(|command| command.enabled && command.name == true_parsed.command)
                .cloned()
            else {
                let _ = tap_key(Key::RightArrow);
                cleanup_clipboard_later(extraction.original_clipboard);
                runtime.set_status(format!(
                    "Inline command disabled or missing: //{}",
                    true_parsed.command
                ));
                runtime.suppress.store(false, Ordering::SeqCst);
                return;
            };

            let typed_length = true_parsed.full_text.chars().count();
            let running_marker = INLINE_RUNNING_MARKER;

            let Some(running_text) = replace_last(
                &extraction.selected_text,
                &true_parsed.full_text,
                &running_marker,
            ) else {
                cleanup_clipboard_later(extraction.original_clipboard);
                runtime
                    .set_status("Marker replace failed: command text not found in selected text");
                runtime.suppress.store(false, Ordering::SeqCst);
                return;
            };

            runtime.set_status("Replacing command with RUNNING marker...");
            if let Err(error) = paste_text(&running_text) {
                cleanup_clipboard_later(extraction.original_clipboard);
                runtime.set_status(format!("Marker failed: {error}"));
                runtime.suppress.store(false, Ordering::SeqCst);
                return;
            }

            runtime.set_status("Calling AI...");
            let output = tauri::async_runtime::block_on(ai::run_custom_prompt(
                command.action,
                command.prompt,
                true_parsed.content.clone(),
                settings_snapshot,
            ));

            match output {
                Ok((output_text, full_prompt)) => {
                    runtime.set_status(format!("LLM Input:\n{}", full_prompt));
                    runtime.set_status(format!("LLM Output:\n{}", output_text));
                    let execution = InlineExecution {
                        command: true_parsed.command,
                        action: command.action,
                        input: true_parsed.content,
                        typed_length,
                        output: output_text,
                    };
                    let final_text = replace_last(&running_text, running_marker, &execution.output)
                        .unwrap_or_else(|| running_text.clone());
                    if let Err(error) = replace_focused_text(&final_text) {
                        runtime.set_status(format!("Paste result failed: {error}"));
                    } else {
                        thread::sleep(Duration::from_millis(PASTE_SETTLE_MS));
                        runtime.set_status("Done!");
                    }
                }
                Err(error) => {
                    let message = format!("[TextSpeed error: {error}]");
                    let final_text = replace_last(&running_text, running_marker, &message)
                        .unwrap_or(running_text);
                    let _ = replace_focused_text(&final_text);
                    thread::sleep(Duration::from_millis(PASTE_SETTLE_MS));
                    runtime.set_status(format!("AI failed: {error}"));
                }
            }

            cleanup_clipboard_later(extraction.original_clipboard);
            thread::sleep(Duration::from_millis(120));
            runtime.suppress.store(false, Ordering::SeqCst);
        });
    }

    fn maybe_handle_hotkey(
        &self,
        key: Key,
        settings: &Arc<Mutex<AppSettings>>,
        app: &AppHandle,
    ) -> bool {
        if self.suppress.load(Ordering::SeqCst) {
            return false;
        }

        let Some(key_label) = hotkey_key_label(key) else {
            return false;
        };

        let combo = build_hotkey(
            self.ctrl_down.load(Ordering::SeqCst),
            self.alt_down.load(Ordering::SeqCst),
            self.shift_down.load(Ordering::SeqCst),
            self.meta_down.load(Ordering::SeqCst),
            key_label,
        );

        if combo.is_empty() {
            return false;
        }

        let settings_snapshot = match settings.lock() {
            Ok(settings) => settings.clone(),
            Err(_) => return false,
        };

        if hotkey_id(&combo) == hotkey_id(&settings_snapshot.popup_hotkey) {
            if let Ok(mut buffer) = self.buffer.lock() {
                buffer.clear();
            }
            self.set_status(format!("Hotkey: floating menu ({combo})"));
            self.open_floating_menu(app.clone(), combo);
            return true;
        }

        if hotkey_id(&combo) == hotkey_id(&settings_snapshot.ocr_hotkey) {
            if let Ok(mut buffer) = self.buffer.lock() {
                buffer.clear();
            }
            self.set_status(format!("Hotkey: OCR snip requested ({combo})"));
            emit_hotkey_event(app, "ocr", combo);
            show_main_window(app);
            return true;
        }

        false
    }

    fn open_floating_menu(&self, app: AppHandle, combo: String) {
        if self
            .suppress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        let runtime = self.clone();
        thread::spawn(move || {
            let (cursor_x, cursor_y) = runtime
                .last_mouse_pos
                .lock()
                .map(|pos| *pos)
                .unwrap_or((320.0, 240.0));
            runtime.set_status("Copying selected text for floating menu...");
            if let Err(error) = copy_selection_to_clipboard() {
                runtime.set_status(format!("Floating menu copy failed: {error}"));
            }
            thread::sleep(Duration::from_millis(120));
            open_floating_window(&app, cursor_x, cursor_y);
            emit_hotkey_event(&app, "popup", combo);
            thread::sleep(Duration::from_millis(180));
            runtime.suppress.store(false, Ordering::SeqCst);
        });
    }

    fn set_status(&self, value: impl Into<String>) {
        if let Ok(mut status) = self.status.lock() {
            let msg = value.into();
            let timestamp = chrono::Local::now().format("%H:%M:%S.%3f").to_string();
            let formatted = format!("[{}] {}", timestamp, msg);
            println!("[Inline] {}", formatted);
            status.push(formatted);
            if status.len() > 50 {
                status.remove(0);
            }
        }
    }
}

fn should_probe_inline_from_buffer(buffer: &str) -> bool {
    let trimmed = buffer.trim_end();
    if !trimmed.ends_with('/') {
        return false;
    }

    let Some(start) = trimmed.rfind("//") else {
        return false;
    };
    let body_start = start + 2;
    let body_end = trimmed.len() - 1;
    if body_start >= body_end {
        return false;
    }

    let body = &trimmed[body_start..body_end];
    let body = body.trim_start();
    let Some(command_end) = body.find(char::is_whitespace) else {
        return false;
    };
    let command = &body[..command_end];
    !command.is_empty()
        && command
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

#[cfg(test)]
mod tests {
    use super::{build_hotkey, hotkey_id, replace_last, should_probe_inline_from_buffer};

    #[test]
    fn slash_prefix_alone_does_not_probe_or_panic() {
        assert!(!should_probe_inline_from_buffer("/"));
        assert!(!should_probe_inline_from_buffer("//"));
        assert!(!should_probe_inline_from_buffer("///"));
    }

    #[test]
    fn probes_only_when_command_has_content_shape() {
        assert!(!should_probe_inline_from_buffer("//tr/"));
        assert!(should_probe_inline_from_buffer("//tr pasted text/"));
    }

    #[test]
    fn replaces_last_inline_command_occurrence() {
        let source = "old //tr hello/ middle //tr hello/";
        assert_eq!(
            replace_last(source, "//tr hello/", "[running]").unwrap(),
            "old //tr hello/ middle [running]"
        );
    }

    #[test]
    fn normalizes_configured_hotkeys_for_matching() {
        assert_eq!(build_hotkey(false, true, false, false, "V"), "Alt + V");
        assert_eq!(hotkey_id("Alt + V"), hotkey_id("alt+v"));
        assert_eq!(hotkey_id("Windows + Space"), hotkey_id("Win + Space"));
    }
}

fn normalized_key_text(key: Key, _text: Option<&str>, shift: bool) -> Option<char> {
    match key {
        Key::KeyA => Some(if shift { 'A' } else { 'a' }),
        Key::KeyB => Some(if shift { 'B' } else { 'b' }),
        Key::KeyC => Some(if shift { 'C' } else { 'c' }),
        Key::KeyD => Some(if shift { 'D' } else { 'd' }),
        Key::KeyE => Some(if shift { 'E' } else { 'e' }),
        Key::KeyF => Some(if shift { 'F' } else { 'f' }),
        Key::KeyG => Some(if shift { 'G' } else { 'g' }),
        Key::KeyH => Some(if shift { 'H' } else { 'h' }),
        Key::KeyI => Some(if shift { 'I' } else { 'i' }),
        Key::KeyJ => Some(if shift { 'J' } else { 'j' }),
        Key::KeyK => Some(if shift { 'K' } else { 'k' }),
        Key::KeyL => Some(if shift { 'L' } else { 'l' }),
        Key::KeyM => Some(if shift { 'M' } else { 'm' }),
        Key::KeyN => Some(if shift { 'N' } else { 'n' }),
        Key::KeyO => Some(if shift { 'O' } else { 'o' }),
        Key::KeyP => Some(if shift { 'P' } else { 'p' }),
        Key::KeyQ => Some(if shift { 'Q' } else { 'q' }),
        Key::KeyR => Some(if shift { 'R' } else { 'r' }),
        Key::KeyS => Some(if shift { 'S' } else { 's' }),
        Key::KeyT => Some(if shift { 'T' } else { 't' }),
        Key::KeyU => Some(if shift { 'U' } else { 'u' }),
        Key::KeyV => Some(if shift { 'V' } else { 'v' }),
        Key::KeyW => Some(if shift { 'W' } else { 'w' }),
        Key::KeyX => Some(if shift { 'X' } else { 'x' }),
        Key::KeyY => Some(if shift { 'Y' } else { 'y' }),
        Key::KeyZ => Some(if shift { 'Z' } else { 'z' }),
        Key::Num0 => Some(if shift { ')' } else { '0' }),
        Key::Num1 => Some(if shift { '!' } else { '1' }),
        Key::Num2 => Some(if shift { '@' } else { '2' }),
        Key::Num3 => Some(if shift { '#' } else { '3' }),
        Key::Num4 => Some(if shift { '$' } else { '4' }),
        Key::Num5 => Some(if shift { '%' } else { '5' }),
        Key::Num6 => Some(if shift { '^' } else { '6' }),
        Key::Num7 => Some(if shift { '&' } else { '7' }),
        Key::Num8 => Some(if shift { '*' } else { '8' }),
        Key::Num9 => Some(if shift { '(' } else { '9' }),
        Key::Minus => Some(if shift { '_' } else { '-' }),
        Key::Equal => Some(if shift { '+' } else { '=' }),
        Key::Space => Some(' '),
        Key::Return => Some('\n'),
        Key::Dot => Some(if shift { '>' } else { '.' }),
        Key::Comma => Some(if shift { '<' } else { ',' }),
        Key::Slash => Some(if shift { '?' } else { '/' }),
        _ => None,
    }
}

fn hotkey_key_label(key: Key) -> Option<&'static str> {
    match key {
        Key::Backspace => Some("Backspace"),
        Key::Delete => Some("Delete"),
        Key::DownArrow => Some("Down"),
        Key::End => Some("End"),
        Key::Escape => Some("Esc"),
        Key::F1 => Some("F1"),
        Key::F2 => Some("F2"),
        Key::F3 => Some("F3"),
        Key::F4 => Some("F4"),
        Key::F5 => Some("F5"),
        Key::F6 => Some("F6"),
        Key::F7 => Some("F7"),
        Key::F8 => Some("F8"),
        Key::F9 => Some("F9"),
        Key::F10 => Some("F10"),
        Key::F11 => Some("F11"),
        Key::F12 => Some("F12"),
        Key::Home => Some("Home"),
        Key::Insert => Some("Insert"),
        Key::KeyA => Some("A"),
        Key::KeyB => Some("B"),
        Key::KeyC => Some("C"),
        Key::KeyD => Some("D"),
        Key::KeyE => Some("E"),
        Key::KeyF => Some("F"),
        Key::KeyG => Some("G"),
        Key::KeyH => Some("H"),
        Key::KeyI => Some("I"),
        Key::KeyJ => Some("J"),
        Key::KeyK => Some("K"),
        Key::KeyL => Some("L"),
        Key::KeyM => Some("M"),
        Key::KeyN => Some("N"),
        Key::KeyO => Some("O"),
        Key::KeyP => Some("P"),
        Key::KeyQ => Some("Q"),
        Key::KeyR => Some("R"),
        Key::KeyS => Some("S"),
        Key::KeyT => Some("T"),
        Key::KeyU => Some("U"),
        Key::KeyV => Some("V"),
        Key::KeyW => Some("W"),
        Key::KeyX => Some("X"),
        Key::KeyY => Some("Y"),
        Key::KeyZ => Some("Z"),
        Key::LeftArrow => Some("Left"),
        Key::PageDown => Some("PageDown"),
        Key::PageUp => Some("PageUp"),
        Key::Return | Key::KpReturn => Some("Enter"),
        Key::RightArrow => Some("Right"),
        Key::Slash => Some("/"),
        Key::Space => Some("Space"),
        Key::Tab => Some("Tab"),
        Key::UpArrow => Some("Up"),
        Key::Num0 | Key::Kp0 => Some("0"),
        Key::Num1 | Key::Kp1 => Some("1"),
        Key::Num2 | Key::Kp2 => Some("2"),
        Key::Num3 | Key::Kp3 => Some("3"),
        Key::Num4 | Key::Kp4 => Some("4"),
        Key::Num5 | Key::Kp5 => Some("5"),
        Key::Num6 | Key::Kp6 => Some("6"),
        Key::Num7 | Key::Kp7 => Some("7"),
        Key::Num8 | Key::Kp8 => Some("8"),
        Key::Num9 | Key::Kp9 => Some("9"),
        _ => None,
    }
}

fn build_hotkey(ctrl: bool, alt: bool, shift: bool, meta: bool, key: &str) -> String {
    let mut parts = Vec::new();
    if ctrl {
        parts.push("Ctrl");
    }
    if alt {
        parts.push("Alt");
    }
    if shift {
        parts.push("Shift");
    }
    if meta {
        parts.push("Win");
    }
    if parts.is_empty() && !key.starts_with('F') {
        return String::new();
    }
    parts.push(key);
    parts.join(" + ")
}

fn hotkey_id(value: &str) -> String {
    value
        .split('+')
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .map(|part| match part.as_str() {
            "control" => "ctrl".to_string(),
            "windows" | "meta" | "cmd" | "command" => "win".to_string(),
            "escape" => "esc".to_string(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn emit_hotkey_event(app: &AppHandle, action: &'static str, hotkey: String) {
    let _ = app.emit("textspeed-hotkey", HotkeyEventPayload { action, hotkey });
}

fn open_floating_window(app: &AppHandle, cursor_x: f64, cursor_y: f64) {
    let x = cursor_x.round() as i32 + 12;
    let y = cursor_y.round() as i32 + 12;
    let position = Position::Physical(PhysicalPosition::new(x, y));

    let window = if let Some(window) = app.get_webview_window("floating") {
        window
    } else {
        match WebviewWindowBuilder::new(
            app,
            "floating",
            WebviewUrl::App("index.html?window=floating".into()),
        )
        .title("TextSpeed Floating Menu")
        .inner_size(FLOATING_WINDOW_WIDTH, FLOATING_WINDOW_HEIGHT)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .focused(true)
        .build()
        {
            Ok(window) => window,
            Err(error) => {
                println!("[Inline] Floating window failed: {error:?}");
                show_main_window(app);
                return;
            }
        }
    };

    let _ = window.set_position(position);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

struct InlineExtraction {
    parsed: InlineMatch,
    selected_text: String,
    original_clipboard: Option<String>,
}

fn extract_inline_command_from_focused_text<F>(mut log: F) -> Result<InlineExtraction, String>
where
    F: FnMut(&str),
{
    log("Reading original clipboard...");
    let original_clipboard = clipboard::read_text().ok();

    log("Selecting all text (Ctrl+A)...");
    simulate(&EventType::KeyPress(Key::ControlLeft)).ok();
    thread::sleep(Duration::from_millis(10));
    let _ = tap_key(Key::KeyA);
    thread::sleep(Duration::from_millis(15));
    simulate(&EventType::KeyRelease(Key::ControlLeft)).ok();

    log("Copying selection (Ctrl+C)...");
    if let Err(e) = copy_selection_to_clipboard() {
        cleanup_clipboard_later(original_clipboard);
        return Err(e);
    }

    log("Waiting for clipboard data...");
    let mut selected = String::new();
    for _ in 0..15 {
        thread::sleep(Duration::from_millis(20));
        if let Ok(text) = clipboard::read_text() {
            if !text.is_empty() {
                selected = text;
                if Some(&selected) != original_clipboard.as_ref() {
                    break;
                }
            }
        }
    }

    log(&format!("Clipboard length: {}", selected.chars().count()));

    if let Some(parsed) = parse_inline_buffer(&selected) {
        log("Command matches syntax!");
        Ok(InlineExtraction {
            parsed,
            selected_text: selected,
            original_clipboard,
        })
    } else {
        cleanup_clipboard_later(original_clipboard);
        Err("Command not found in clipboard".to_string())
    }
}

fn replace_last(source: &str, needle: &str, replacement: &str) -> Option<String> {
    let start = source.rfind(needle)?;
    let end = start + needle.len();
    let mut output = String::with_capacity(source.len() - needle.len() + replacement.len());
    output.push_str(&source[..start]);
    output.push_str(replacement);
    output.push_str(&source[end..]);
    Some(output)
}

fn copy_selection_to_clipboard() -> Result<(), String> {
    simulate(&EventType::KeyPress(Key::ControlLeft)).map_err(|error| format!("{error:?}"))?;
    thread::sleep(Duration::from_millis(10));
    let key_c_press =
        simulate(&EventType::KeyPress(Key::KeyC)).map_err(|error| format!("{error:?}"));
    thread::sleep(Duration::from_millis(10));
    let key_c_release =
        simulate(&EventType::KeyRelease(Key::KeyC)).map_err(|error| format!("{error:?}"));
    thread::sleep(Duration::from_millis(10));
    let control_release =
        simulate(&EventType::KeyRelease(Key::ControlLeft)).map_err(|error| format!("{error:?}"));
    key_c_press?;
    key_c_release?;
    control_release
}

fn replace_focused_text(output: &str) -> Result<(), String> {
    select_all_text()?;
    paste_text(output)
}

fn paste_text(output: &str) -> Result<(), String> {
    clipboard::write_text(output.to_string())?;
    thread::sleep(Duration::from_millis(CLIPBOARD_WRITE_SETTLE_MS));
    paste_from_clipboard()?;
    thread::sleep(Duration::from_millis(PASTE_SETTLE_MS));
    Ok(())
}

fn cleanup_clipboard_later(previous_clipboard: Option<String>) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(CLIPBOARD_CLEANUP_DELAY_MS));
        let _ = clipboard::write_text(previous_clipboard.unwrap_or_default());
    });
}

fn select_all_text() -> Result<(), String> {
    simulate(&EventType::KeyPress(Key::ControlLeft)).map_err(|error| format!("{error:?}"))?;
    thread::sleep(Duration::from_millis(20));
    let key_a = tap_key(Key::KeyA);
    thread::sleep(Duration::from_millis(20));
    let control_release =
        simulate(&EventType::KeyRelease(Key::ControlLeft)).map_err(|error| format!("{error:?}"));
    key_a?;
    control_release?;
    thread::sleep(Duration::from_millis(SELECT_ALL_SETTLE_MS));
    Ok(())
}

fn paste_from_clipboard() -> Result<(), String> {
    simulate(&EventType::KeyPress(Key::ControlLeft)).map_err(|error| format!("{error:?}"))?;
    thread::sleep(Duration::from_millis(24));
    simulate(&EventType::KeyPress(Key::KeyV)).map_err(|error| format!("{error:?}"))?;
    thread::sleep(Duration::from_millis(18));
    simulate(&EventType::KeyRelease(Key::KeyV)).map_err(|error| format!("{error:?}"))?;
    thread::sleep(Duration::from_millis(24));
    simulate(&EventType::KeyRelease(Key::ControlLeft)).map_err(|error| format!("{error:?}"))
}

fn tap_key(key: Key) -> Result<(), String> {
    simulate(&EventType::KeyPress(key)).map_err(|error| format!("{error:?}"))?;
    thread::sleep(Duration::from_millis(10));
    simulate(&EventType::KeyRelease(key)).map_err(|error| format!("{error:?}"))
}
