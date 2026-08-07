/**
 * Значения намеренно указаны через var(), а не хексами.
 *
 * Утилиты Tailwind живут в слое tw-utils, который перебивает
 * весь остальной CSS (см. index-redesign.css). Пока здесь стояли
 * хексы тёмной палитры, любой bg-card в JSX возвращал #0f1318
 * поверх macOS-темы — то есть светлая тема ломалась ровно в тех
 * 108 местах, где этот класс используется.
 *
 * Ограничение: с var() не работает модификатор прозрачности
 * (bg-card/50) — Tailwind не умеет вставлять alpha в готовый
 * цвет. В проекте таких мест нет ни одного, поэтому обмен
 * выгодный. Если появятся — брать готовый токен -dim.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        card: 'var(--card)',
        'card-hi': 'var(--card-hi)',
        inset: 'var(--inset)',
        border: 'var(--border)',
        'border-hi': 'var(--border-hi)',
        separator: 'var(--separator)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        'green-t': 'var(--green-t)',
        'red-t': 'var(--red-t)',
        'yellow-t': 'var(--yellow-t)',
        'blue-t': 'var(--blue-t)',
        'orange-t': 'var(--orange-t)',
        'teal-t': 'var(--teal-t)',
        'gray-t': 'var(--text-3)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
    },
  },
  plugins: [],
};
