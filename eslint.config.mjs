import next from "eslint-config-next";

const config = [
  ...next,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
];

export default config;
