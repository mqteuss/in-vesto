/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",     
    "./**/*.js",         
    "!./node_modules/**" // <--- ESSA LINHA CORRIGE A LENTIDÃO
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}