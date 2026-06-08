let currentSession = null

export function getSession() {
  return currentSession
}

export function setSession(user) {
  currentSession = user ? { userId: user.userId ?? user.id, name: user.name, role: user.role } : null
}

export function clearSession() {
  currentSession = null
}

export function requireSession() {
  if (!currentSession) {
    throw new Error('Not authenticated')
  }
  return currentSession
}

export function requireOwner() {
  const session = requireSession()
  if (session.role !== 'owner') {
    throw new Error('Owner access required')
  }
  return session
}

export function requireStaffOrOwner() {
  return requireSession()
}
