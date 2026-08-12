const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const INVITATION_TOKEN_STORAGE_KEY = 'allfit-invitation-token:v1'

export function validInvitationToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

export function readPendingInvitationToken(): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  try {
    const token = sessionStorage.getItem(INVITATION_TOKEN_STORAGE_KEY)
    if (validInvitationToken(token)) return token
    if (token) sessionStorage.removeItem(INVITATION_TOKEN_STORAGE_KEY)
  } catch {
    // A disabled store is treated as an absent pending invitation.
  }
  return undefined
}

export function clearPendingInvitationToken(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(INVITATION_TOKEN_STORAGE_KEY)
  } catch {
    // The token is tab-scoped and the browser clears an inaccessible store.
  }
}

export function invitationTokenCaptureScript(): string {
  return `(function(){if(window.location.pathname!='/invitations')return;try{var h=window.location.hash.slice(1);var p=new URLSearchParams(h);var t=p.get('token');if(t&&/^[A-Za-z0-9_-]{43}$/.test(t)){sessionStorage.setItem('${INVITATION_TOKEN_STORAGE_KEY}',t);}if(window.location.hash){history.replaceState(history.state,'',window.location.pathname+window.location.search);}}catch(_){if(window.location.hash){history.replaceState(history.state,'',window.location.pathname+window.location.search);}}})();`
}
