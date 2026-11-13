/** Drive preferences through their public Settings entry point. Preserve an already-open dialog. */
export async function openWorkshopPreferences(page) {
  const dialog = page.locator('#hardware-dialog');
  const wasOpen = await dialog.evaluate(element => element.open);
  if (!wasOpen) await page.locator('#hardware-open').click();
  const section = page.locator('.preferences-section');
  if (!await section.evaluate(element => element.open)) await section.locator('summary').click();
  return wasOpen;
}

export async function chooseWorkshopPreference(page, preference, value) {
  const wasOpen = await openWorkshopPreferences(page);
  await page.locator(`#${preference}-select`).selectOption(value);
  if (!wasOpen) await page.locator('#hardware-dialog [data-close]').first().click();
}
