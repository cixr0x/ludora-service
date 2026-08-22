const PRODUCT_SLUG_FALLBACK = 'juego-de-mesa';

export function publicProductSlug(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : '';
  const slug = source
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || PRODUCT_SLUG_FALLBACK;
}

export function publicProductPath(
  id: unknown,
  canonicalNameEs?: unknown,
  canonicalName?: unknown
): string {
  const parsedId = Number(id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new Error('Product route id must be a positive integer');
  }

  const localizedName = typeof canonicalNameEs === 'string' ? canonicalNameEs.trim() : '';
  const fallbackName = typeof canonicalName === 'string' ? canonicalName.trim() : '';
  return `/game/${parsedId}/${publicProductSlug(localizedName || fallbackName)}`;
}
