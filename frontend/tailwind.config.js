/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          500: '#1d6ff2',
          600: '#0f5bd6',
          700: '#1048a8',
        },
      },
    },
  },
  plugins: [],
};