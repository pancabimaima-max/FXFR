import rawTokens from "../../../../packages/design-tokens/tokens.json";

import type { ThemeName, ThemeTokenDocument, TokenLeaf, TokenTree } from "@/types/theme";

const tokenDocument = rawTokens as ThemeTokenDocument;

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).toLowerCase();
}

function isTokenTree(value: TokenLeaf | TokenTree): value is TokenTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setCssVariable(style: CSSStyleDeclaration, path: string[], value: TokenLeaf): void {
  const variableName = `--fx-${path.map(toKebabCase).join("-")}`;
  style.setProperty(variableName, String(value));
}

function applyTree(style: CSSStyleDeclaration, path: string[], branch: TokenTree): void {
  Object.entries(branch).forEach(([key, value]) => {
    const nextPath = [...path, key];
    if (isTokenTree(value)) {
      applyTree(style, nextPath, value);
      return;
    }
    setCssVariable(style, nextPath, value);
  });
}

function readThemeLeaf(theme: TokenTree, path: string[]): string {
  let cursor: TokenLeaf | TokenTree = theme;
  for (const key of path) {
    if (!isTokenTree(cursor) || !(key in cursor)) {
      return "";
    }
    cursor = cursor[key] as TokenLeaf | TokenTree;
  }
  return isTokenTree(cursor) ? "" : String(cursor);
}

const legacyAliases: Array<{ legacy: string; path: string[] }> = [
  { legacy: "--bg", path: ["color", "shell", "canvas"] },
  { legacy: "--surface", path: ["color", "surface", "base"] },
  { legacy: "--surface-alt", path: ["color", "surface", "alt"] },
  { legacy: "--text", path: ["color", "text", "primary"] },
  { legacy: "--muted", path: ["color", "text", "muted"] },
  { legacy: "--accent", path: ["color", "accent", "primary"] },
  { legacy: "--green", path: ["color", "state", "success"] },
  { legacy: "--yellow", path: ["color", "state", "warning"] },
  { legacy: "--red", path: ["color", "state", "danger"] },
  { legacy: "--border", path: ["color", "surface", "border"] },
];

export function applyThemeTokens(themeName: ThemeName = "amd"): void {
  if (typeof document === "undefined") {
    return;
  }

  const fallbackTheme = tokenDocument.themes?.amd;
  const theme = tokenDocument.themes?.[themeName] ?? fallbackTheme;
  if (!theme) {
    return;
  }

  const root = document.documentElement;
  root.setAttribute("data-theme", themeName);

  applyTree(root.style, [], theme);

  legacyAliases.forEach(({ legacy, path }) => {
    const value = readThemeLeaf(theme, path);
    if (value) {
      root.style.setProperty(legacy, value);
    }
  });
}
