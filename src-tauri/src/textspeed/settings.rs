use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_preferred_language")]
    pub preferred_language: String,
    #[serde(default = "default_translation_language_a")]
    pub translation_language_a: String,
    #[serde(default = "default_translation_language_b")]
    pub translation_language_b: String,
    #[serde(default)]
    pub provider: AiProvider,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub openai_api_key: String,
    #[serde(default)]
    pub gemini_api_key: String,
    #[serde(default = "default_popup_hotkey")]
    pub popup_hotkey: String,
    #[serde(default = "default_ocr_hotkey")]
    pub ocr_hotkey: String,
    #[serde(default = "default_inline_enabled")]
    pub inline_enabled: bool,
    #[serde(default = "default_inline_commands")]
    pub commands: Vec<InlineCommand>,
    #[serde(default = "default_floating_actions")]
    pub floating_actions: Vec<FloatingAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Openai,
    Gemini,
}

impl Default for AiProvider {
    fn default() -> Self {
        Self::Openai
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineCommand {
    pub name: String,
    pub label: String,
    pub action: AiAction,
    pub prompt: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingAction {
    pub id: String,
    pub label: String,
    pub action: AiAction,
    pub prompt: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiAction {
    Translate,
    Summarize,
    Reply,
    Explain,
    Fix,
    Professional,
    Mail,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            preferred_language: default_preferred_language(),
            translation_language_a: default_translation_language_a(),
            translation_language_b: default_translation_language_b(),
            provider: AiProvider::Openai,
            model: default_model(),
            openai_api_key: String::new(),
            gemini_api_key: String::new(),
            popup_hotkey: default_popup_hotkey(),
            ocr_hotkey: default_ocr_hotkey(),
            inline_enabled: default_inline_enabled(),
            commands: default_inline_commands(),
            floating_actions: default_floating_actions(),
        }
    }
}

fn default_preferred_language() -> String {
    "Tiếng Việt".to_string()
}

fn default_translation_language_a() -> String {
    "Tiếng Việt".to_string()
}

fn default_translation_language_b() -> String {
    "English".to_string()
}

fn default_model() -> String {
    "gpt-4.1-mini".to_string()
}

fn default_popup_hotkey() -> String {
    "Alt + Space".to_string()
}

fn default_ocr_hotkey() -> String {
    "Ctrl + Shift + S".to_string()
}

fn default_inline_enabled() -> bool {
    true
}

fn default_inline_commands() -> Vec<InlineCommand> {
    vec![
        InlineCommand {
            name: "trans".to_string(),
            label: "Translate".to_string(),
            action: AiAction::Translate,
            prompt: "Dịch theo cặp ngôn ngữ đã cấu hình. Tự phát hiện ngôn ngữ nguồn và dịch sang ngôn ngữ còn lại."
                .to_string(),
            enabled: true,
        },
        InlineCommand {
            name: "fix".to_string(),
            label: "Fix grammar".to_string(),
            action: AiAction::Fix,
            prompt: "Sửa chính tả, ngữ pháp, dấu câu. Không giải thích.".to_string(),
            enabled: true,
        },
        InlineCommand {
            name: "pro".to_string(),
            label: "Professional".to_string(),
            action: AiAction::Professional,
            prompt: "Viết lại theo phong cách chuyên nghiệp, ngắn gọn và lịch sự."
                .to_string(),
            enabled: true,
        },
        InlineCommand {
            name: "mail".to_string(),
            label: "Email draft".to_string(),
            action: AiAction::Mail,
            prompt: "Tạo email hoàn chỉnh có tiêu đề, lời chào, nội dung, kết thúc."
                .to_string(),
            enabled: true,
        },
    ]
}

fn default_floating_actions() -> Vec<FloatingAction> {
    vec![
        FloatingAction {
            id: "translate".to_string(),
            label: "Translate".to_string(),
            action: AiAction::Translate,
            prompt: "Dịch theo cặp ngôn ngữ đã cấu hình. Tự phát hiện ngôn ngữ nguồn và dịch sang ngôn ngữ còn lại."
                .to_string(),
            enabled: true,
        },
        FloatingAction {
            id: "summarize".to_string(),
            label: "Summary".to_string(),
            action: AiAction::Summarize,
            prompt: "Tóm tắt nội dung thành các ý chính ngắn gọn.".to_string(),
            enabled: true,
        },
        FloatingAction {
            id: "reply".to_string(),
            label: "Reply".to_string(),
            action: AiAction::Reply,
            prompt: "Gợi ý một câu trả lời ngắn, tự nhiên, phù hợp ngữ cảnh.".to_string(),
            enabled: true,
        },
        FloatingAction {
            id: "explain".to_string(),
            label: "Explain".to_string(),
            action: AiAction::Explain,
            prompt: "Giải thích nội dung, thuật ngữ hoặc đoạn mã thật dễ hiểu.".to_string(),
            enabled: true,
        },
    ]
}
