use serde::Serialize;

use super::settings::AiAction;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineMatch {
    pub command: String,
    pub content: String,
    pub full_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineExecution {
    pub command: String,
    pub action: AiAction,
    pub input: String,
    pub output: String,
    pub typed_length: usize,
}

const INLINE_PREFIX: &str = "//";
const INLINE_TERMINATOR: char = '/';

pub fn parse_inline_buffer(buffer: &str) -> Option<InlineMatch> {
    let trimmed = buffer.trim_end();
    if !trimmed.ends_with(INLINE_TERMINATOR) {
        return None;
    }

    let start = trimmed.rfind(INLINE_PREFIX)?;
    let candidate = &trimmed[start..];
    let body = candidate
        .strip_prefix(INLINE_PREFIX)?
        .strip_suffix(INLINE_TERMINATOR)?;

    let mut parts = body.trim_start().splitn(2, char::is_whitespace);
    let command = parts.next()?.trim();
    let content = parts.next()?.trim();

    if command.is_empty()
        || content.is_empty()
        || !command
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }

    Some(InlineMatch {
        command: command.to_string(),
        content: content.to_string(),
        full_text: candidate.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::parse_inline_buffer;

    #[test]
    fn parses_slash_terminated_inline_command() {
        let parsed = parse_inline_buffer("//pro gui file cho anh nhe/").unwrap();
        assert_eq!(parsed.command, "pro");
        assert_eq!(parsed.content, "gui file cho anh nhe");
        assert_eq!(parsed.full_text, "//pro gui file cho anh nhe/");
    }

    #[test]
    fn ignores_unfinished_command() {
        assert!(parse_inline_buffer("//trans hello ").is_none());
        assert!(parse_inline_buffer("//trans/").is_none());
        assert!(parse_inline_buffer("/trans hello/").is_none());
    }

    #[test]
    fn parses_latest_inline_command_from_surrounding_text() {
        let parsed = parse_inline_buffer("noi dung truoc //fix toi dang di hoc/").unwrap();
        assert_eq!(parsed.command, "fix");
        assert_eq!(parsed.content, "toi dang di hoc");
    }
}
