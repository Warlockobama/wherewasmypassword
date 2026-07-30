/** A single stored site credential, encrypted inside VaultData.entries. */
export interface Credential {
  id: string
  /** Display label (e.g. "GitHub" or "Work email"). */
  label: string
  /** URL pattern for autofill matching (e.g. "https://github.com"). */
  url: string
  username: string
  password: string
  notes: string
  createdAt: number
  updatedAt: number
}
