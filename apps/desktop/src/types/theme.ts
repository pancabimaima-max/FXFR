export type TokenLeaf = string | number;

export type TokenTree = {
  [key: string]: TokenLeaf | TokenTree;
};

export type ThemeName = string;

export type ThemeTokenDocument = {
  meta?: {
    name?: string;
    version?: string;
  };
  themes: Record<string, TokenTree>;
};
