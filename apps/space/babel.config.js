// babel-preset-expo covers React Native, JSX and expo-router. Nothing else is
// added here: every extra transform is one more thing that behaves differently
// between Metro and the test runner.

module.exports = function babelConfig(api) {
  api.cache(true)
  return { presets: ['babel-preset-expo'] }
}
