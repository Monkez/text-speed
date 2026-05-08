import type { AppSettings } from "../lib/tauri";

export const fallbackSettings: AppSettings = {
  preferredLanguage: "Tiếng Việt",
  translationLanguageA: "Tiếng Việt",
  translationLanguageB: "English",
  provider: "openai",
  model: "gpt-4.1-mini",
  openaiApiKey: "",
  geminiApiKey: "",
  popupHotkey: "Alt + Space",
  ocrHotkey: "Ctrl + Shift + S",
  inlineEnabled: true,
  commands: [
    {
      name: "trans",
      label: "Translate",
      action: "translate",
      prompt: "Dịch theo cặp ngôn ngữ ưu tiên; nếu nguồn nằm ngoài cặp này thì dịch sang ngôn ngữ ưu tiên.",
      enabled: true,
    },
    {
      name: "fix",
      label: "Fix grammar",
      action: "fix",
      prompt: "Sửa chính tả, ngữ pháp, dấu câu. Không giải thích.",
      enabled: true,
    },
    {
      name: "pro",
      label: "Professional",
      action: "professional",
      prompt: "Viết lại theo phong cách chuyên nghiệp, ngắn gọn và lịch sự.",
      enabled: true,
    },
    {
      name: "mail",
      label: "Email draft",
      action: "mail",
      prompt: "Tạo email hoàn chỉnh có tiêu đề, lời chào, nội dung, kết thúc.",
      enabled: true,
    },
  ],
  floatingActions: [
    {
      id: "translate",
      label: "Translate",
      action: "translate",
      prompt: "Dịch theo cặp ngôn ngữ ưu tiên; nếu nguồn nằm ngoài cặp này thì dịch sang ngôn ngữ ưu tiên.",
      enabled: true,
    },
    {
      id: "summarize",
      label: "Summary",
      action: "summarize",
      prompt: "Tóm tắt nội dung thành các ý chính ngắn gọn.",
      enabled: true,
    },
    {
      id: "reply",
      label: "Reply",
      action: "reply",
      prompt: "Gợi ý một câu trả lời ngắn, tự nhiên, phù hợp ngữ cảnh.",
      enabled: true,
    },
    {
      id: "explain",
      label: "Explain",
      action: "explain",
      prompt: "Giải thích nội dung, thuật ngữ hoặc đoạn mã thật dễ hiểu.",
      enabled: true,
    },
  ],
};
