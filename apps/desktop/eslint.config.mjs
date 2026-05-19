import { config } from "@amical/eslint-config/base";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
