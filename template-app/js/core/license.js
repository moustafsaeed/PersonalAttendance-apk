/**
 * License & Security Module
 * A reusable module for managing application trial periods and licensing.
 */

const LicenseManager = {
    settingsKey: 'app_license_data',
    trialDays: 7,

    /**
     * Initializes the license manager, checks trial status, and enforces locks if necessary.
     */
    init: function() {
        this.data = JSON.parse(localStorage.getItem(this.settingsKey)) || {
            deviceId: this.generateDeviceId(),
            installDate: new Date().getTime(),
            isActivated: false,
            activationKey: null
        };
        this.save();
        this.checkStatus();
    },

    save: function() {
        localStorage.setItem(this.settingsKey, JSON.stringify(this.data));
    },

    generateDeviceId: function() {
        return 'DEV-' + Math.random().toString(36).substr(2, 9).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    },

    getDeviceId: function() {
        return this.data.deviceId;
    },

    isActivated: function() {
        return this.data.isActivated;
    },

    getDaysRemaining: function() {
        const now = new Date().getTime();
        const elapsed = now - this.data.installDate;
        const daysElapsed = Math.floor(elapsed / (1000 * 60 * 60 * 24));
        return Math.max(0, this.trialDays - daysElapsed);
    },

    checkStatus: function() {
        if (this.isActivated()) {
            this.hideTrialBanner();
            return 'active';
        }

        const daysLeft = this.getDaysRemaining();
        if (daysLeft <= 0) {
            this.showExpiredModal();
            return 'expired';
        } else {
            this.showTrialBanner(daysLeft);
            return 'trial';
        }
    },

    verifyKey: function(inputKey) {
        // Basic placeholder logic. In production, use cryptographic validation matching the deviceId.
        // Example logic: The key must start with "ACT-" and end with a hash of the Device ID.
        if (!inputKey || inputKey.trim() === '') return false;

        // Dummy validation: accepts any key starting with "ACT-"
        if (inputKey.trim().startsWith('ACT-')) {
            this.data.isActivated = true;
            this.data.activationKey = inputKey.trim();
            this.save();
            return true;
        }
        return false;
    },

    // UI Integrations (To be overridden or connected to actual UI elements)
    showTrialBanner: function(daysLeft) {
        const banner = document.getElementById('trialBanner');
        const count = document.getElementById('trialCountdown');
        if (banner) {
            banner.classList.remove('hidden');
            banner.style.opacity = '1';
            banner.style.transform = 'none';
        }
        if (count) count.textContent = `${daysLeft} أيام متبقية`;
        console.log(`[License] Trial mode active. ${daysLeft} days remaining.`);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (banner && !banner.classList.contains('hidden')) {
                banner.style.opacity = '0';
                banner.style.transform = 'translateY(-20px)';
                setTimeout(() => banner.classList.add('hidden'), 500);
            }
        }, 10000);
    },

    hideTrialBanner: function() {
        const banner = document.getElementById('trialBanner');
        if (banner) banner.classList.add('hidden');
    },

    showExpiredModal: function() {
        const modal = document.getElementById('trialExpiredM');
        const devIdDisplay = document.getElementById('trialDeviceIdDisplay');
        if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
        }
        if (devIdDisplay) devIdDisplay.value = this.getDeviceId();
        console.warn('[License] Trial expired. App is locked.');
    },

    sendLicenseRequest: function(phoneNumber = '1234567890') {
        const message = `مرحباً، أود شراء النسخة الكاملة للتطبيق.%0Aمعرف جهازي هو: ${this.getDeviceId()}`;
        window.open(`https://wa.me/${phoneNumber}?text=${message}`, '_blank');
    }
};

// Auto-initialize on load
window.addEventListener('DOMContentLoaded', () => {
    LicenseManager.init();
});

// Expose globally for UI actions
window.LicenseManager = LicenseManager;
