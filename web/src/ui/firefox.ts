export const isFirefox = (): boolean => typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);

export const firefoxOnWindows = (): boolean => isFirefox() && /\bWindows NT\b/.test(navigator.userAgent);
