import eslint from '@electron-toolkit/eslint-config'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  eslint,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // This is a deliberately PropTypes-free plain-JS React app; runtime prop
      // validation is not used. Re-exporting screens from barrel modules is
      // intentional and does not need the Fast-Refresh-only-components rule.
      'react/prop-types': 'off',
      'react-refresh/only-export-components': 'off',
      // Known pre-existing baseline, downgraded to warnings so lint can gate NEW
      // issues while these are tracked as follow-ups: a few screens define small
      // helper components inside render (static-components), and the data-loading
      // screens setState inside a load effect (set-state-in-effect) — a common,
      // intentional pattern here.
      'react-hooks/static-components': 'warn',
      'react-hooks/set-state-in-effect': 'warn'
    }
  },
  {
    // Test + node-side helpers use Node globals and console freely.
    files: ['test/**/*.js', '**/*.config.{js,mjs}'],
    rules: {
      'no-console': 'off'
    }
  },
  eslintConfigPrettier
]
