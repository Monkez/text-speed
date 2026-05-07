use tauri::{AppHandle, Manager, State};

use crate::TextSpeedState;

use super::{
    ai, clipboard,
    inline::{self, InlineExecution, InlineMatch},
    settings::{AiAction, AppSettings},
    store,
};

#[tauri::command]
pub fn get_settings(state: State<'_, TextSpeedState>) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map(|settings| settings.clone())
        .map_err(|_| "Settings lock poisoned".to_string())
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    app: AppHandle,
    state: State<'_, TextSpeedState>,
) -> Result<AppSettings, String> {
    let mut current = state
        .settings
        .lock()
        .map_err(|_| "Settings lock poisoned".to_string())?;
    *current = settings.clone();
    state.inline_runtime.set_enabled(settings.inline_enabled);
    store::save_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn read_clipboard_text() -> Result<String, String> {
    clipboard::read_text()
}

#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    clipboard::write_text(text)
}

#[tauri::command]
pub fn hide_floating_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("floating") {
        window.hide().map_err(|error| format!("{error:?}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| format!("{error:?}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn parse_inline_buffer(buffer: String) -> Option<InlineMatch> {
    inline::parse_inline_buffer(&buffer)
}

#[tauri::command]
pub async fn execute_inline_command(
    buffer: String,
    state: State<'_, TextSpeedState>,
) -> Result<Option<InlineExecution>, String> {
    let Some(parsed) = inline::parse_inline_buffer(&buffer) else {
        return Ok(None);
    };

    let settings = state
        .settings
        .lock()
        .map_err(|_| "Settings lock poisoned".to_string())?
        .clone();

    if !settings.inline_enabled {
        return Ok(None);
    }

    let Some(command) = settings
        .commands
        .iter()
        .find(|command| command.enabled && command.name == parsed.command)
        .cloned()
    else {
        return Ok(None);
    };

    let output = ai::run_custom_prompt(
        command.action,
        command.prompt,
        parsed.content.clone(),
        settings,
    )
    .await?;

    Ok(Some(InlineExecution {
        command: parsed.command,
        action: command.action,
        input: parsed.content,
        output: output.0,
        typed_length: parsed.full_text.chars().count(),
    }))
}

#[tauri::command]
pub async fn run_ai_action(
    action: AiAction,
    text: String,
    state: State<'_, TextSpeedState>,
) -> Result<String, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Settings lock poisoned".to_string())?
        .clone();
    ai::run(action, text, settings).await
}

#[tauri::command]
pub async fn run_floating_action(
    action_id: String,
    text: String,
    state: State<'_, TextSpeedState>,
) -> Result<String, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Settings lock poisoned".to_string())?
        .clone();

    let Some(action) = settings
        .floating_actions
        .iter()
        .find(|action| action.enabled && action.id == action_id)
        .cloned()
    else {
        return Err(format!("Floating action disabled or missing: {action_id}"));
    };

    let (output, _) =
        ai::run_custom_prompt(action.action, action.prompt, text, settings).await?;
    Ok(output)
}

#[tauri::command]
pub async fn get_model_ids(settings: AppSettings) -> Result<Vec<String>, String> {
    ai::list_model_ids(settings).await
}

#[derive(serde::Serialize)]
pub struct RuntimeStatus {
    pub system: Vec<String>,
    pub inline: Vec<String>,
}

#[tauri::command]
pub fn get_runtime_status(state: State<'_, TextSpeedState>) -> RuntimeStatus {
    RuntimeStatus {
        system: vec![
            "Settings persistence ready".to_string(),
            "Clipboard bridge ready".to_string(),
            "AI provider bridge ready".to_string(),
            "Global hotkey hook ready".to_string(),
            "OCR roadmap only".to_string(),
        ],
        inline: state.inline_runtime.status(),
    }
}
