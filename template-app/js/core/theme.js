/**
 * Theme Manager Module
 * Handles light/dark mode and accent colors dynamically.
 */

const ThemeManager = {
    settingsKey: 'app_theme_prefs',

    init: function() {
        this.prefs = JSON.parse(localStorage.getItem(this.settingsKey)) || {
            mode: 'light', // 'light' | 'dark'
            accent: 'blue' // 'blue' | 'green'
        };
        this.apply();
    },

    save: function() {
        localStorage.setItem(this.settingsKey, JSON.stringify(this.prefs));
    },

    setMode: function(mode) {
        this.prefs.mode = mode;
        this.save();
        this.apply();
    },

    toggleMode: function() {
        this.setMode(this.prefs.mode === 'light' ? 'dark' : 'light');
        return this.prefs.mode;
    },

    setAccent: function(color) {
        this.prefs.accent = color;
        this.save();
        this.apply();
    },

    apply: function() {
        const html = document.documentElement;
        const body = document.body;

        // Apply Dark/Light Mode
        if (this.prefs.mode === 'dark') {
            html.classList.add('dark');
            html.setAttribute('data-theme', 'dark');
        } else {
            html.classList.remove('dark');
            html.setAttribute('data-theme', 'light');
        }

        // Apply Accent Color
        body.setAttribute('data-accent', this.prefs.accent);
        if (this.prefs.accent === 'green') {
            body.classList.add('theme-green');
        } else {
            body.classList.remove('theme-green');
        }
    }
};

// Auto-initialize on load
window.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
});

window.ThemeManager = ThemeManager;
