use reqwest::Client;
use serde_json::json;

use super::settings::{AiAction, AiProvider, AppSettings};

pub async fn run(action: AiAction, text: String, settings: AppSettings) -> Result<String, String> {
    let prompt = build_prompt(action, &text, &settings);
    run_prompt(prompt, settings).await
}

pub async fn run_custom_prompt(
    action: AiAction,
    prompt: String,
    text: String,
    settings: AppSettings,
) -> Result<(String, String), String> {
    let instruction = build_custom_instruction(action, &prompt, &settings);
    let complete_prompt = serde_json::to_string_pretty(&json!({
        "instruction": instruction,
        "input": text,
        "format": "Return only the final replacement text. Do not explain, do not list options, do not wrap the answer in quotes."
    }))
    .unwrap_or_else(|_| text.clone());
    let result = run_prompt(complete_prompt.clone(), settings).await?;
    Ok((result, complete_prompt))
}

async fn run_prompt(prompt: String, settings: AppSettings) -> Result<String, String> {
    match settings.provider {
        AiProvider::Openai => run_openai(&prompt, &settings).await,
        AiProvider::Gemini => run_gemini(&prompt, &settings).await,
    }
}

async fn run_openai(prompt: &str, settings: &AppSettings) -> Result<String, String> {
    let api_key = provider_key(&settings.openai_api_key, "OPENAI_API_KEY")?;
    let client = Client::new();
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
          "model": settings.model,
          "input": prompt,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let value: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    if let Some(output) = value["output_text"]
        .as_str()
        .or_else(|| value["output"][0]["content"][0]["text"].as_str())
    {
        Ok(output.to_string())
    } else if let Some(err_msg) = value["error"]["message"].as_str() {
        Err(format!("OpenAI API Error: {}", err_msg))
    } else {
        Err(format!("OpenAI response error: {}", value))
    }
}

async fn run_gemini(prompt: &str, settings: &AppSettings) -> Result<String, String> {
    let api_key = provider_key(&settings.gemini_api_key, "GEMINI_API_KEY")?;
    let client = Client::new();
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        settings.model, api_key
    );
    let response = client
        .post(url)
        .json(&json!({
          "contents": [{
            "parts": [{ "text": prompt }]
          }]
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let value: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    if let Some(output) = value["candidates"][0]["content"]["parts"][0]["text"].as_str() {
        Ok(output.to_string())
    } else if let Some(err_msg) = value["error"]["message"].as_str() {
        Err(format!("Gemini API Error: {}", err_msg))
    } else {
        Err(format!("Gemini response error: {}", value))
    }
}

pub async fn list_model_ids(settings: AppSettings) -> Result<Vec<String>, String> {
    match settings.provider {
        AiProvider::Openai => list_openai_model_ids(&settings).await,
        AiProvider::Gemini => list_gemini_model_ids(&settings).await,
    }
}

async fn list_openai_model_ids(settings: &AppSettings) -> Result<Vec<String>, String> {
    let api_key = provider_key(&settings.openai_api_key, "OPENAI_API_KEY")?;
    let client = Client::new();
    let value: serde_json::Value = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    if let Some(err_msg) = value["error"]["message"].as_str() {
        return Err(format!("OpenAI API Error: {err_msg}"));
    }

    let mut ids = value["data"]
        .as_array()
        .ok_or_else(|| format!("OpenAI models response error: {value}"))?
        .iter()
        .filter_map(|model| model["id"].as_str())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

async fn list_gemini_model_ids(settings: &AppSettings) -> Result<Vec<String>, String> {
    let api_key = provider_key(&settings.gemini_api_key, "GEMINI_API_KEY")?;
    let client = Client::new();
    let value: serde_json::Value = client
        .get(format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        ))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    if let Some(err_msg) = value["error"]["message"].as_str() {
        return Err(format!("Gemini API Error: {err_msg}"));
    }

    let mut ids = value["models"]
        .as_array()
        .ok_or_else(|| format!("Gemini models response error: {value}"))?
        .iter()
        .filter(|model| match model["supportedGenerationMethods"].as_array() {
            Some(methods) => methods
                .iter()
                .any(|method| method.as_str() == Some("generateContent")),
            None => true,
        })
        .filter_map(|model| model["name"].as_str())
        .map(|name| name.strip_prefix("models/").unwrap_or(name).to_string())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn provider_key(saved_key: &str, env_name: &str) -> Result<String, String> {
    let trimmed = saved_key.trim();
    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }
    std::env::var(env_name).map_err(|_| format!("{env_name} is not set"))
}

fn build_prompt(action: AiAction, text: &str, settings: &AppSettings) -> String {
    let instruction = match action {
        AiAction::Translate => translation_instruction(settings),
        AiAction::Summarize => "Summarize the text into concise key points.".to_string(),
        AiAction::Reply => {
            "Read the text and write one short, natural reply. Return only the reply.".to_string()
        }
        AiAction::Explain => {
            "Explain the text, term, or code in clear and simple language.".to_string()
        }
        AiAction::Fix => {
            "Fix spelling, grammar, punctuation, and wording. Return only the corrected version."
                .to_string()
        }
        AiAction::Professional => {
            "Rewrite the text in a professional, concise, and polite style.".to_string()
        }
        AiAction::Mail => {
            "Create a complete email from the topic, including subject, greeting, body, and closing."
                .to_string()
        }
    };
    serde_json::to_string_pretty(&json!({
        "instruction": instruction,
        "input": text,
        "format": "Return only the final output. Do not explain."
    }))
    .unwrap_or_else(|_| text.to_string())
}

fn build_custom_instruction(action: AiAction, prompt: &str, settings: &AppSettings) -> String {
    if matches!(action, AiAction::Translate) {
        format!(
            "{}\n\nTranslation rule: {}",
            prompt.trim(),
            translation_instruction(settings)
        )
    } else {
        prompt.trim().to_string()
    }
}

fn translation_instruction(settings: &AppSettings) -> String {
    format!(
        "Translate using TextSpeed language routing. Preferred bilingual pair: '{}' and '{}'. Fallback target language: '{}'. Detect the primary input language. If the input is primarily '{}', translate it to '{}'. If the input is primarily '{}', translate it to '{}'. If the input language is not primarily '{}' or '{}', translate it to '{}'. Return only the translated text.",
        settings.translation_language_a,
        settings.translation_language_b,
        settings.preferred_language,
        settings.translation_language_a,
        settings.translation_language_b,
        settings.translation_language_b,
        settings.translation_language_a,
        settings.translation_language_a,
        settings.translation_language_b,
        settings.preferred_language,
    )
}
