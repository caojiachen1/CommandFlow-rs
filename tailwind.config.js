/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          light: '#f8fafc',
          dark: '#202020',
        },
        background: {
          DEFAULT: '#202020',
        },
      },
    },
  },
  plugins: [],
}

