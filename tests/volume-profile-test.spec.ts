import { test, expect } from '@playwright/test';

test.describe('Volume Profile Date/Time Selection', () => {
  test('should show date and time inputs when VP button is clicked', async ({ page }) => {
    // Navigate to crypto dashboard
    await page.goto('http://localhost:3000/cryptoDashboard');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Find and click the VP button
    const vpButton = page.locator('button:has-text("VP")');
    await expect(vpButton).toBeVisible();
    console.log('VP button found');

    // Click VP button to enable volume profile
    await vpButton.click();
    console.log('VP button clicked');

    // Wait for the date inputs to appear
    await page.waitForTimeout(500);

    // Check for date inputs
    const dateInputs = page.locator('input[type="date"]');
    const dateCount = await dateInputs.count();
    console.log(`Found ${dateCount} date inputs`);

    // Check for time inputs
    const timeInputs = page.locator('input[type="time"]');
    const timeCount = await timeInputs.count();
    console.log(`Found ${timeCount} time inputs`);

    // Verify date inputs are visible
    expect(dateCount).toBeGreaterThanOrEqual(2);

    // Verify time inputs are visible
    expect(timeCount).toBeGreaterThanOrEqual(2);

    // Check for UTC labels
    const utcLabels = page.locator('text=UTC');
    const utcCount = await utcLabels.count();
    console.log(`Found ${utcCount} UTC labels`);
    expect(utcCount).toBeGreaterThanOrEqual(2);
  });

  test('should allow changing date and time values', async ({ page }) => {
    await page.goto('http://localhost:3000/cryptoDashboard');
    await page.waitForLoadState('networkidle');

    // Enable VP
    await page.locator('button:has-text("VP")').click();
    await page.waitForTimeout(500);

    // Get the first date input
    const startDateInput = page.locator('input[type="date"]').first();
    await expect(startDateInput).toBeVisible();

    // Get current value
    const originalValue = await startDateInput.inputValue();
    console.log(`Original start date: ${originalValue}`);

    // Try to change the date
    await startDateInput.fill('2025-01-01');

    // Verify the value changed
    const newValue = await startDateInput.inputValue();
    console.log(`New start date: ${newValue}`);
    expect(newValue).toBe('2025-01-01');

    // Get the first time input
    const startTimeInput = page.locator('input[type="time"]').first();
    await expect(startTimeInput).toBeVisible();

    // Get current time value
    const originalTime = await startTimeInput.inputValue();
    console.log(`Original start time: ${originalTime}`);

    // Try to change the time
    await startTimeInput.fill('09:30');

    // Verify the time changed
    const newTime = await startTimeInput.inputValue();
    console.log(`New start time: ${newTime}`);
    expect(newTime).toBe('09:30');
  });

  test('should show bins selector when VP is active', async ({ page }) => {
    await page.goto('http://localhost:3000/cryptoDashboard');
    await page.waitForLoadState('networkidle');

    // Enable VP
    await page.locator('button:has-text("VP")').click();
    await page.waitForTimeout(500);

    // Check for bins selector
    const binsSelect = page.locator('select');
    await expect(binsSelect.first()).toBeVisible();

    // Get available options
    const options = await binsSelect.first().locator('option').allTextContents();
    console.log('Bins options:', options);

    expect(options).toContain('25 bins');
    expect(options).toContain('50 bins');
    expect(options).toContain('75 bins');
    expect(options).toContain('100 bins');
  });

  test('should take screenshot of VP controls', async ({ page }) => {
    await page.goto('http://localhost:3000/cryptoDashboard');
    await page.waitForLoadState('networkidle');

    // Enable VP
    await page.locator('button:has-text("VP")').click();
    await page.waitForTimeout(1000);

    // Take screenshot of the header area with VP controls
    await page.screenshot({
      path: 'tests/screenshots/vp-controls.png',
      fullPage: false
    });

    console.log('Screenshot saved to tests/screenshots/vp-controls.png');
  });
});
