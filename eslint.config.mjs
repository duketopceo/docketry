import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/components/**/*.{ts,tsx}", "apps/web/app/**/*.{ts,tsx}"],
    ignores: ["apps/web/components/app/icons.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message: "Import product icons from components/app/icons.ts — the single icon facade (Silver Lining section 17).",
            },
          ],
        },
      ],
    },
  },
);
