import base from "../../eslint.config.mjs";

export default [
  ...base,
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["components/app/icons.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@phosphor-icons/react",
              message:
                "Import product icons from components/app/icons.ts — the single icon facade (Silver Lining section 17).",
            },
          ],
          patterns: [
            {
              group: ["@phosphor-icons/react/*"],
              message:
                "Import product icons from components/app/icons.ts — the single icon facade (Silver Lining section 17).",
            },
          ],
        },
      ],
    },
  },
];
