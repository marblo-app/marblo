/** @type {import('tailwindcss').Config} */
const tokenColor = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./src/index.html"],
  theme: {
    extend: {
      backgroundColor: {
        "surface-app": tokenColor("surface-app"),
        "surface-panel": tokenColor("surface-panel"),
        "surface-raised": tokenColor("surface-raised"),
        "surface-hover": tokenColor("surface-hover"),
        accent: tokenColor("accent"),
        "accent-hover": tokenColor("accent-hover"),
        success: tokenColor("success"),
        warning: tokenColor("warning"),
        danger: tokenColor("danger"),
      },
      borderColor: {
        subtle: tokenColor("border-subtle"),
        default: tokenColor("border-default"),
        strong: tokenColor("border-strong"),
        accent: tokenColor("accent"),
        "accent-hover": tokenColor("accent-hover"),
        success: tokenColor("success"),
        warning: tokenColor("warning"),
        danger: tokenColor("danger"),
      },
      textColor: {
        primary: tokenColor("text-primary"),
        secondary: tokenColor("text-secondary"),
        muted: tokenColor("text-muted"),
        "on-accent": tokenColor("text-on-accent"),
        accent: tokenColor("accent"),
        "accent-hover": tokenColor("accent-hover"),
        success: tokenColor("success"),
        warning: tokenColor("warning"),
        danger: tokenColor("danger"),
      },
    },
  },
  plugins: [],
};
