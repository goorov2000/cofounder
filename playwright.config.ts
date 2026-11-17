import { defineConfig } from '@playwright/test';
const baseURL=process.env.T06_ACCEPTANCE_URL??'http://localhost:3000';
export default defineConfig({ testDir:'tests/e2e', fullyParallel:false, use:{baseURL,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}}, webServer:{command:'npm run dev',url:baseURL,reuseExistingServer:true}, reporter:'list' });
