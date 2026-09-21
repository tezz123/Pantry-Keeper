/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#173128',
    tint: '#2f7255',

    // Core surfaces
    background: '#f7f6f1',
    foreground: '#173128',

    // Cards / elevated surfaces
    card: '#fffdf8',
    cardForeground: '#173128',

    // Primary action color (buttons, links, active states)
    primary: '#2f7255',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#e7efe8',
    secondaryForeground: '#275640',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ecece5',
    mutedForeground: '#6f786e',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#f4e5c3',
    accentForeground: '#744e1c',

    // Destructive actions (delete, error states)
    destructive: '#c8644b',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#dedfd5',
    input: '#d6d9ce',

    // Pantry Keeper brand tokens
    forest: '#173128',
    green: '#2f7255',
    sage: '#dbe8dc',
    cream: '#f7f6f1',
    sand: '#f4e5c3',
    amber: '#b87927',
    terracotta: '#c8644b',
    white: '#fffdf8',
  },

  dark: {
    text: '#f2f4ec',
    tint: '#8fc59d',
    background: '#14221c',
    foreground: '#f2f4ec',
    card: '#1d3026',
    cardForeground: '#f2f4ec',
    primary: '#8fc59d',
    primaryForeground: '#14221c',
    secondary: '#263e31',
    secondaryForeground: '#dcefe0',
    muted: '#24342b',
    mutedForeground: '#a6b8aa',
    accent: '#6a512b',
    accentForeground: '#ffe7ae',
    destructive: '#e4896d',
    destructiveForeground: '#24120d',
    border: '#31483a',
    input: '#3b5442',
    forest: '#f2f4ec',
    green: '#8fc59d',
    sage: '#294533',
    cream: '#14221c',
    sand: '#6a512b',
    amber: '#f1bb66',
    terracotta: '#e4896d',
    white: '#1d3026',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
