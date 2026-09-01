import tseslint from "typescript-eslint";

export default [
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    ignores: ["src/wasm/pkg/**/*"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } }
    },
    rules: { "no-console": "error", "no-unused-vars": "off" }
  }
];
