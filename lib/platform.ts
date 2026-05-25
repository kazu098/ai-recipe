// iOS ネイティブアプリ内の WKWebView から送られるカスタム UA を検出する
// Xcode 側で `SnapmealApp/iOS` を UA に追記することで判定する
export function detectIsIOSApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /SnapmealApp\/iOS/.test(navigator.userAgent);
}
