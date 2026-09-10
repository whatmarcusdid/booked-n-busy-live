/**
 * Normalize a URL by ensuring it has a protocol
 * Bare domains are converted to https://
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();

  // If it already has a protocol (any protocol), return as-is
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Add https:// to bare domains
  return `https://${trimmed}`;
}

/**
 * Validate that a URL uses http or https protocol
 * @param url - URL to validate
 * @returns true if valid, error message if invalid
 */
export function validateHttpUrl(
  url: string,
): { valid: true } | { valid: false; error: string } {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return {
      valid: false,
      error: "Invalid URL format",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: "URL must use http or https protocol",
    };
  }

  if (!parsed.hostname || parsed.hostname.length === 0) {
    return {
      valid: false,
      error: "URL must have a valid hostname",
    };
  }

  return { valid: true };
}

/**
 * Normalize and validate a URL in one step
 */
export function normalizeAndValidateUrl(
  input: string,
): { success: true; url: string } | { success: false; error: string } {
  const normalized = normalizeUrl(input);
  const validation = validateHttpUrl(normalized);

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  return {
    success: true,
    url: normalized,
  };
}
