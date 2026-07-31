import { fillablePageOrigin } from '../credentials/match-url.ts'
import { isExtensionContext } from '../platform.ts'

export interface TargetTab {
  tabId: number
  /** Canonical origin, `www.` dropped — what travels with the fill request. */
  origin: string
  /** Bare hostname, for showing the user which page they are about to fill. */
  host: string
}

/** Why there is nothing to fill, in the order the popup wants to explain it. */
export type TargetProblem =
  | 'no-extension'
  /** No active tab at all — an empty window, or the browser is starting up. */
  | 'no-tab'
  /**
   * The tab is there but its URL is invisible to us. That means the `activeTab`
   * grant did not arrive, which for a popup means it was not opened from the
   * toolbar button — worth saying plainly rather than showing an empty list.
   */
  | 'url-hidden'
  /** A `chrome://` page, a PDF viewer, our own pages: nothing fillable. */
  | 'not-a-web-page'

export interface TargetTabResult {
  tab: TargetTab | null
  problem?: TargetProblem
}

/**
 * The page this popup is pointed at.
 *
 * This is the whole reason the popup exists. Clicking the toolbar button grants
 * `activeTab` for the tab the user is looking at, and — unlike the full tab UI,
 * which becomes the active tab itself and so grants nothing useful — a popup is
 * not a tab, so the page underneath stays active and stays granted. The proof
 * that the grant arrived is `tab.url` being readable at all: without a host
 * permission the browser withholds it.
 */
export async function resolveTargetTab(): Promise<TargetTabResult> {
  if (!isExtensionContext() || !chrome.tabs?.query) return { tab: null, problem: 'no-extension' }

  // `currentWindow` is the window the popup is hanging off, so this is the tab
  // the user was looking at when they clicked — not merely some active tab.
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) return { tab: null, problem: 'no-tab' }
  if (!tab.url) return { tab: null, problem: 'url-hidden' }

  const page = fillablePageOrigin(tab.url)
  if (!page) return { tab: null, problem: 'not-a-web-page' }
  return { tab: { tabId: tab.id, origin: page.origin, host: page.host } }
}

/**
 * Ask the background worker to open (or focus) the full memory-house tab.
 *
 * The worker owns this rather than the popup because the popup is torn down the
 * instant the new tab takes focus, which would cut the `getContexts` lookup —
 * the thing that stops a second unlocked session being opened — in half.
 */
export function openMemoryHouse(): void {
  if (!isExtensionContext() || !chrome.runtime?.sendMessage) return
  chrome.runtime.sendMessage({ type: 'wwmp-open-app' }, () => {
    // The popup usually dies before the response lands; reading lastError here
    // just stops the browser logging an unchecked-error warning.
    void chrome.runtime.lastError
  })
}
