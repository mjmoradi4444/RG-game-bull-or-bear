/**
 * RebateGain brand tokens — sampled directly from the official logos (Logo1/Logo2)
 * and the build spec (§6). These exact values are the single source of truth for
 * every color, gradient, and font in Rebate Rush.
 *
 * The palette itself encodes the lesson:
 *   - BLUE      = the RebateGain brand (chrome, primary buttons, brand moments).
 *   - GREEN/RED = universal trading convention, used ONLY for P&L + hazards.
 *   - GOLD      = the rebate. Kept deliberately distinct from blue (so it pops) and
 *                 from green (so "rebate is NOT the same as winning" stays obvious).
 */

export const colors = {
  // Surfaces — the logo navy
  bg: '#101830',
  surface: '#171F3A',
  border: '#283154',

  // RebateGain brand blue (left → right gradient)
  brandBlueFrom: '#0A78FF',
  brandBlueTo: '#2A4BFF',

  // Text
  text: '#FFFFFF',
  textMuted: '#8A94A6',

  // Functional trading colors (NOT brand) — P&L meter + hazards only
  up: '#16C784',
  down: '#EA3943',

  // The hero: rebate gold (jar + coins)
  rebateGold: '#F5C451',
  rebateGoldLight: '#FFE08A',
} as const;

export const gradients = {
  brandBlue: [colors.brandBlueFrom, colors.brandBlueTo] as const,
};

export const fonts = {
  family: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  // Inter is the RebateGain brand font; a subset is self-hosted in the brand phase.
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
} as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export type Colors = typeof colors;
export type ColorToken = keyof Colors;
