/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",     // <--- Olha especificamente o seu HTML na raiz
    "./**/*.js"         // <--- Olha seus arquivos JS (para classes dinâmicas)
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
