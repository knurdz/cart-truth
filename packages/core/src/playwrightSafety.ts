import type { Page, Request } from "playwright";

export const FORBIDDEN_PURCHASE_TEXT =
  /\b(place\s+order|submit\s+order|buy\s+now|confirm\s+purchase|pay\s+now|complete\s+order|purchase\s+now)\b/i;

export const BLOCKER_TEXT =
  /\b(captcha|verify\s+you\s+are\s+(a\s+)?human|robot|access\s+denied|temporarily\s+blocked|unusual\s+traffic|are\s+you\s+human)\b/i;

export const LOGIN_REQUIRED_TEXT =
  /\b(sign\s+in|log\s+in|enter\s+your\s+password|verification\s+code|two[-\s]?step|multi[-\s]?factor|mfa)\b/i;

export function assertSafeActionLabel(label: string): void {
  if (FORBIDDEN_PURCHASE_TEXT.test(label)) {
    throw new Error(`Refusing unsafe purchase action: ${label}`);
  }
}

export function isFinalizationRequestLike(requestOrUrl: Request | string, postData = ""): boolean {
  const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.url();
  const method = typeof requestOrUrl === "string" ? "POST" : requestOrUrl.method();
  const body = typeof requestOrUrl === "string" ? postData : requestOrUrl.postData() ?? "";

  if (!["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    return false;
  }

  const haystack = `${url}\n${body}`;
  return /\b(place[-_]?order|submit[-_]?order|checkout\/order|order\/submit|payment\/capture|payments?\/authorize|purchase|complete[-_]?order)\b/i.test(haystack);
}

export async function installNeverPurchaseGuards(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (isFinalizationRequestLike(request)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

export function classifyPageText(text: string): "captcha" | "blocked" | "login_required" | undefined {
  if (/\bcaptcha\b/i.test(text)) {
    return "captcha";
  }
  if (BLOCKER_TEXT.test(text)) {
    return "blocked";
  }
  if (LOGIN_REQUIRED_TEXT.test(text)) {
    return "login_required";
  }
  return undefined;
}

export async function classifyPageState(page: Page): Promise<"captcha" | "blocked" | "login_required" | undefined> {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return classifyPageText(bodyText);
}

export async function guardedClickByRole(page: Page, name: RegExp | string): Promise<void> {
  const label = typeof name === "string" ? name : name.source;
  assertSafeActionLabel(label);
  await page.getByRole("button", { name }).first().click();
}
