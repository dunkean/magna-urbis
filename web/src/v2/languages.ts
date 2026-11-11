export const LANGUAGES = [
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'pt', name: 'Português', locale: 'pt-BR' },
  { code: 'zh', name: '中文', locale: 'zh-CN' },
  { code: 'ar', name: 'العربية', locale: 'ar' },
  { code: 'ru', name: 'Русский', locale: 'ru-RU' },
  { code: 'ja', name: '日本語', locale: 'ja-JP' },
] as const;
export type Language = typeof LANGUAGES[number]['code'];
export const isLanguage = (value: unknown): value is Language => LANGUAGES.some(item => item.code === value);
