/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // a new feature
        "fix", // a bug fix
        "docs", // documentation only
        "style", // formatting, no code change
        "refactor", // code change that neither fixes a bug nor adds a feature
        "perf", // performance improvement
        "test", // adding or fixing tests
        "build", // build system or external dependencies
        "ci", // CI configuration
        "chore", // other changes that don't modify src or test files
        "revert", // reverts a previous commit
      ],
    ],
    "subject-case": [2, "never", ["upper-case", "pascal-case"]],
    "subject-max-length": [2, "always", 100],
    "body-max-line-length": [1, "always", 120],
  },
};

export default config;
