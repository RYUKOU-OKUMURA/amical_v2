import { shell } from "electron";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "x-apple.systempreferences:",
  "ms-settings:",
]);

export function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error(`Blocked external URL: ${url}`);
  }

  await shell.openExternal(url);
}
