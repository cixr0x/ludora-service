import { describe, expect, it } from 'vitest';

import { publicProductPath, publicProductSlug } from './productRoutes.js';

describe('public product routes', () => {
  it('builds lowercase ASCII slugs from localized public titles', () => {
    expect(publicProductPath(851, 'Díxit: Edición México', 'Dixit')).toBe(
      '/game/851/dixit-edicion-mexico'
    );
  });

  it('falls back to the canonical title and then a stable generic slug', () => {
    expect(publicProductPath('871', '', 'Catan')).toBe('/game/871/catan');
    expect(publicProductSlug('将棋')).toBe('juego-de-mesa');
  });

  it('rejects invalid product ids', () => {
    expect(() => publicProductPath(0, 'Dixit')).toThrow('positive integer');
  });
});
