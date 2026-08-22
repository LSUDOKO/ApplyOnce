/** Conventional commits — these drive semantic-release versioning. */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert',
    ]],
    'scope-enum': [1, 'always', [
      'mcp', 'adapters', 'mapping', 'profile', 'safety', 'fixture', 'deps', 'deps-dev',
      'release', 'README', 'ci',
    ]],
    'body-max-line-length': [0],     // long explanatory bodies are encouraged
    'footer-max-line-length': [0],
  },
};
