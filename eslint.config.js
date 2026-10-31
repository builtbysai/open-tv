import ts from "typescript-eslint";

export default ts.config(
  { ignores: ["dist/**", "node_modules/**", "control/node_modules/**", "test-results/**"] },
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true, caughtErrors: "none" },
      ],
      // A cross-origin frame is addressed by origin, never "*": see docs/SERVER_CONTRACT.md.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='postMessage'][arguments.1.value='*']",
          message:
            "Post to an explicit origin. The only place allowed to use '*' is public/bridge/opentv-embed.js.",
        },
      ],
    },
  },
);
