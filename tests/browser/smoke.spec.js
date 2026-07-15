import { test, expect } from "@playwright/test";
import { selectors as s } from "./selectors.js";

test("unified layer editor adds, selects, edits, and plays without console errors", async ({ page }) => {
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/");
  await page.locator(s.welcomeJustPlay).waitFor({ state: "visible" });
  await page.locator(s.welcomeJustPlay).click();
  await page.locator(s.tourSkip).waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await page.locator(s.tourSkip).isVisible()) await page.locator(s.tourSkip).click();

  await page.locator(s.subnoteTab).click();
  await expect(page.locator(s.layerRows)).toHaveCount(1);
  await page.locator(s.layerAdd).click();
  await expect(page.locator(s.layerRows)).toHaveCount(2);
  await expect(page.locator(s.editTag)).toHaveText("editing Layer 2");

  await page.locator(s.variation).fill("0.77");
  await page.locator(s.baseRow).click();
  await expect(page.locator(s.editTag)).toHaveText("editing Layer 1");
  await expect(page.locator(s.variation)).toHaveValue("0.35");

  await page.locator(s.play).click();
  await page.locator(s.play).click();
  expect(errors).toEqual([]);
});

test("Sound Generator 2.0 advanced excitor, resonator, and body controls are live", async ({ page }) => {
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator(s.welcomeJustPlay).click();
  await page.locator(s.tourSkip).waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await page.locator(s.tourSkip).isVisible()) await page.locator(s.tourSkip).click();
  await page.locator(s.subnoteTab).click();

  await page.locator('details:has-text("Advanced excitation") summary').click();
  await page.locator('[data-param="velocityHardnessCoupling"]').fill("0.55");
  await page.locator('[data-ch-stage="resonator"]').click();
  await page.locator('details:has-text("Advanced shaping") summary').click();
  await page.locator('[data-param="dynamicBlare"]').fill("0.8");
  await page.locator('[data-param="decaySecondStage"]').fill("0.7");
  await page.locator('[data-param-select="resonatorClass"]').selectOption("conicalTube");
  await page.locator('[data-ch-stage="body"]').click();
  await page.locator('details:has-text("Advanced vocal body") summary').click();
  await page.locator('[data-param="glottalTilt"]').fill("0.35");
  await page.locator('[data-param="singerFormantAmount"]').fill("0.6");
  await page.locator('[data-param="voiceBreathSync"]').fill("0.4");

  await page.locator(s.play).click();
  await page.locator(s.play).click();
  expect(errors).toEqual([]);
});
