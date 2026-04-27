import { expect, type Locator } from '@playwright/test'

export interface ElementBox {
  x: number
  y: number
  width: number
  height: number
}

export async function getRequiredBox(locator: Locator): Promise<ElementBox> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

export async function setTextareaValue(
  locator: Locator,
  value: string
): Promise<void> {
  await locator.evaluate((element, nextValue) => {
    const textarea = element as HTMLTextAreaElement
    textarea.value = nextValue
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
