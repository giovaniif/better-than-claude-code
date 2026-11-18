export interface MobileStatus {
  configured: boolean;
  testFlightUrl?: string;
}

/** Phones cannot reach the desktop's loopback, and setup links carry no credentials. */
export function mobileHost(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "0.0.0.0" || /^127\./.test(host)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function mobileLink(value: string): string | null {
  const host = mobileHost(value);
  return host ? `switchyard://connect?host=${encodeURIComponent(host)}` : null;
}

export function testFlightLink(value?: string): string | null {
  return value && /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]{8}$/.test(value) ? value : null;
}

export function inMobileApp(): boolean {
  return typeof window !== "undefined" && (window as any).SwitchyardMobile?.version === 1;
}
