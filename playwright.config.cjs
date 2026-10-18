const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    workers: 2,
    timeout: 45000,
    expect: { timeout: 7000 },
    reporter: 'list',
    use: {
        headless: true,
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
        { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }
    ]
});
