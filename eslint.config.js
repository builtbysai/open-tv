import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default ts.config(
  { ignores: ["dist/**", "dist-site/**"] },
  ...ts.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "react-hooks": hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
