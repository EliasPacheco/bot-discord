const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
    // Configurações específicas para o ambiente Discloud
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
    browserLaunchOptions: {
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions'
        ]
    }
};