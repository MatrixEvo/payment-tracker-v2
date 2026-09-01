/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./assets/js/**/*.js"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: '#38bdf8',
        'accent-hover': '#0284c7',
        danger: '#ef4444',
        success: '#22c55e',
        warning: '#eab308'
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      }
    }
  },
  plugins: [],
}
