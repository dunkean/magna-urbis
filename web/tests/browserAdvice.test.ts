import { describe, expect, it } from 'vitest';
import { adviceFor, appleMobile, browserKind } from '../src/ui/browserAdvice';

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
  edgeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/131.2903.68 Mobile/15E148 Safari/605.1.15',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsungAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
};

describe('browser advice', () => {
  it('keeps the desktop verdicts', () => {
    expect(browserKind({ userAgent: UA.chromeWindows })).toBe('chrome');
    expect(browserKind({ userAgent: UA.edgeWindows })).toBe('edge');
    expect(adviceFor({ userAgent: UA.chromeWindows })).toBeNull();
    expect(adviceFor({ userAgent: UA.edgeWindows })).toBeNull();
    expect(adviceFor({ userAgent: UA.chromeWindows, brave: true })).toEqual({ kind: 'other' });
    expect(adviceFor({ userAgent: UA.firefoxWindows })).toEqual({ kind: 'other' });
    expect(adviceFor({ userAgent: UA.safariMac, touchPoints: 0 })).toEqual({ kind: 'other' });
    expect(adviceFor({ userAgent: UA.firefoxWindows, tauri: true })).toBeNull();
  });

  it('gives no advice on iOS and iPadOS, where every browser is WebKit', () => {
    for (const userAgent of [UA.safariIphone, UA.chromeIos, UA.firefoxIos, UA.edgeIos]) {
      expect(appleMobile({ userAgent })).toBe(true);
      expect(adviceFor({ userAgent })).toBeNull();
    }
    expect(appleMobile({ userAgent: UA.safariMac, touchPoints: 5 })).toBe(true);
    expect(adviceFor({ userAgent: UA.safariMac, touchPoints: 5 })).toBeNull();
  });

  it('keeps the advice for Android browsers other than Chrome and Edge', () => {
    expect(adviceFor({ userAgent: UA.chromeAndroid, touchPoints: 5 })).toBeNull();
    expect(adviceFor({ userAgent: UA.samsungAndroid, touchPoints: 5 })).toEqual({ kind: 'other' });
    expect(adviceFor({ userAgent: UA.firefoxAndroid, touchPoints: 5 })).toEqual({ kind: 'other' });
  });
});
