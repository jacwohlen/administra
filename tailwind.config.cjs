const { join } = require('path');
const { skeleton } = require('@skeletonlabs/tw-plugin');

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: 'class',
  content: [
    './src/**/*.{html,js,svelte,ts}',
    join(require.resolve('@skeletonlabs/skeleton'), '../**/*.{html,js,svelte,ts}')
  ],
  theme: {
    extend: {}
  },
  plugins: [
    require('@tailwindcss/forms'),
    skeleton({
      themes: {
        custom: [
          {
            name: 'administra',
            properties: {
              // =~= Theme Properties =~=
              '--theme-font-family-base': 'system-ui',
              '--theme-font-family-heading': 'system-ui',
              '--theme-font-color-base': '0 0 0',
              '--theme-font-color-dark': '255 255 255',
              '--theme-rounded-base': '9999px',
              '--theme-rounded-container': '8px',
              '--theme-border-base': '1px',
              // =~= Theme On-X Colors =~=
              '--on-primary': '255 255 255',
              '--on-secondary': '0 0 0',
              '--on-tertiary': '0 0 0',
              '--on-success': '255 255 255',
              '--on-warning': '0 0 0',
              '--on-error': '255 255 255',
              '--on-surface': '0 0 0',
              // primary | #ff0000
              '--color-primary-50': '255 217 217',
              '--color-primary-100': '255 204 204',
              '--color-primary-200': '255 191 191',
              '--color-primary-300': '255 153 153',
              '--color-primary-400': '255 77 77',
              '--color-primary-500': '255 0 0',
              '--color-primary-600': '230 0 0',
              '--color-primary-700': '191 0 0',
              '--color-primary-800': '153 0 0',
              '--color-primary-900': '125 0 0',
              // secondary | #e0e0e0
              '--color-secondary-50': '250 250 250',
              '--color-secondary-100': '249 249 249',
              '--color-secondary-200': '247 247 247',
              '--color-secondary-300': '243 243 243',
              '--color-secondary-400': '233 233 233',
              '--color-secondary-500': '224 224 224',
              '--color-secondary-600': '202 202 202',
              '--color-secondary-700': '168 168 168',
              '--color-secondary-800': '134 134 134',
              '--color-secondary-900': '110 110 110',
              // tertiary | #add8e6
              '--color-tertiary-50': '243 249 251',
              '--color-tertiary-100': '239 247 250',
              '--color-tertiary-200': '235 245 249',
              '--color-tertiary-300': '222 239 245',
              '--color-tertiary-400': '198 228 238',
              '--color-tertiary-500': '173 216 230',
              '--color-tertiary-600': '156 194 207',
              '--color-tertiary-700': '130 162 173',
              '--color-tertiary-800': '104 130 138',
              '--color-tertiary-900': '85 106 113',
              // success | #00ad00
              '--color-success-50': '217 243 217',
              '--color-success-100': '204 239 204',
              '--color-success-200': '191 235 191',
              '--color-success-300': '153 222 153',
              '--color-success-400': '77 198 77',
              '--color-success-500': '0 173 0',
              '--color-success-600': '0 156 0',
              '--color-success-700': '0 130 0',
              '--color-success-800': '0 104 0',
              '--color-success-900': '0 85 0',
              // warning | #d5d553
              '--color-warning-50': '249 249 229',
              '--color-warning-100': '247 247 221',
              '--color-warning-200': '245 245 212',
              '--color-warning-300': '238 238 186',
              '--color-warning-400': '226 226 135',
              '--color-warning-500': '213 213 83',
              '--color-warning-600': '192 192 75',
              '--color-warning-700': '160 160 62',
              '--color-warning-800': '128 128 50',
              '--color-warning-900': '104 104 41',
              // error | #ff0000
              '--color-error-50': '255 217 217',
              '--color-error-100': '255 204 204',
              '--color-error-200': '255 191 191',
              '--color-error-300': '255 153 153',
              '--color-error-400': '255 77 77',
              '--color-error-500': '255 0 0',
              '--color-error-600': '230 0 0',
              '--color-error-700': '191 0 0',
              '--color-error-800': '153 0 0',
              '--color-error-900': '125 0 0',
              // surface | #e0e0e0
              '--color-surface-50': '250 250 250',
              '--color-surface-100': '249 249 249',
              '--color-surface-200': '247 247 247',
              '--color-surface-300': '243 243 243',
              '--color-surface-400': '233 233 233',
              '--color-surface-500': '224 224 224',
              '--color-surface-600': '202 202 202',
              '--color-surface-700': '168 168 168',
              '--color-surface-800': '134 134 134',
              '--color-surface-900': '110 110 110'
            }
          }
        ]
      }
    })
  ]
};

module.exports = config;
