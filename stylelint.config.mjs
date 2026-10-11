// Token-only styling for CSS (docs/design/silver-lining.md section 13).
// Generated token CSS lives in packages/silver-lining and is out of scope: it IS the tokens.
export default {
  ignoreFiles: ["**/node_modules/**", "**/.next/**", "packages/silver-lining/**"],
  rules: {
    "color-no-hex": true,
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla"],
    "declaration-property-value-allowed-list": {
      "/^font-size$/": [
        "/^var\\(/",
        "/^(inherit|initial|unset)$/",
        "/^(11|12|13|14|15|17|24)px$/",
        "/^calc\\(/",
      ],
    },
  },
};
