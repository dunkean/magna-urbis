# Authorized vendor LF-only correction

Applied only LF preservation for `web/src/vendor/polygonClipping.ts` and the targeted `.gitattributes` line `web/src/vendor/polygonClipping.ts text eol=lf`. All prior attributes bytes are preserved. No code/guard/header/test/assertion/hash changed.

1554CRLF→1554LF; source SHA256 `abd019389e46819e3fe56aebcddc79746f9f8de1f06c61ddb98e88bc501b62cf`→`20648f987f0fc5265c845e0821e7b9ea145c0b4dcee2d077ef7c2b1ea45cdb52`. Re-expanding LF to CRLF reproduces every original byte. The exact four guard snippet removals and header stripping used by the existing integrity assertion produce55040bytes exactly equal to installed upstream ESM, SHA256 `766d182d2908c03d19608f90837e870a99df42c313c537363d2a0adb0f44baaa`. Raw old headerless SHA `728510952e657b643c95138810f32c3c7aa1906fe9b360eb989329a64cc077a8` is reproduced. `git check-attr` reports text=set/eol=lf.

Preserved originals and complete hashes: `web/out/polygon-vendor-lf-proof/verification.json`. The existing test file remains SHA256 `f3ba2b7bf0ca911fe2bbe74e9c05dd414641b4313969c9e702a420f9f2c187dc`. No tests executed by this agent; root reruns only the targeted traversal test first.
