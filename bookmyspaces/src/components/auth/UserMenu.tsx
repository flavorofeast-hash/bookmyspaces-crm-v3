'use client'

import { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import { LogOut, User, Settings, ChevronDown, Shield } from 'lucide-react'

interface UserProfile {
  email     : string
  full_name : string | null
  role      : string
  avatar_url: string | null
}

const ROLE_COLORS: Record<string, string> = {
  admin    : 'bg-red-100 text-red-700',
  manager  : 'bg-purple-100 text-purple-700',
  sales    : 'bg-blue-100 text-blue-700',
  marketing: 'bg-green-100 text-green-700',
}

export default function UserMenu() {
  const router  = useRouter()
  const [open,  setOpen]    = useState(false)
  const [user,  setUser]    = useState<UserProfile | null>(null)
  const ref     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadUser() {
      try {
        const supabase = createBrowserClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) return

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('full_name, role, avatar_url')
          .eq('id', session.user.id)
          .single()

        setUser({
          email     : session.user.email ?? '',
          full_name : profile?.full_name ?? null,
          role      : profile?.role ?? 'sales',
          avatar_url: profile?.avatar_url ?? null,
        })
      } catch { /* silent */ }
    }
    loadUser()
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleLogout() {
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  if (!user) return null

  const initials = user.full_name
    ? user.full_name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : user.email[0].toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-gray-100 transition-colors"
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {user.avatar_url
            // avatar_url comes straight from user_profiles with no upload
            // path anywhere in this codebase (grepped — nothing writes this
            // column), so it can be set to any arbitrary external URL, not
            // just the hostnames already allow-listed in next.config.js's
            // images.remotePatterns (supabase.co/bookmyspaces.in/vercel.app).
            // next/image throws at runtime for an unconfigured hostname, so
            // swapping this 28px decorative avatar to next/image would risk
            // breaking rendering for any admin-set avatar on another domain
            // — suppressed rather than "fixed" into a behavior change.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={user.avatar_url} alt={user.full_name ?? ''} className="w-7 h-7 rounded-full object-cover" />
            : initials
          }
        </div>
        <div className="text-left hidden sm:block">
          <p className="text-xs font-semibold text-gray-900 leading-tight">
            {user.full_name ?? user.email.split('@')[0]}
          </p>
          <p className={`text-xs px-1 py-0 rounded font-medium w-fit ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
            {user.role}
          </p>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 hidden sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 z-50 overflow-hidden">
          {/* User info */}
          <div className="px-3.5 py-2.5 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate">{user.full_name ?? 'User'}</p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => { setOpen(false); router.push('/admin?tab=profile') }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User className="w-4 h-4 text-gray-400" />
              My Profile
            </button>
            <button
              onClick={() => { setOpen(false); router.push('/settings') }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-400" />
              Settings
            </button>
            {(user.role === 'admin' || user.role === 'manager') && (
              <button
                onClick={() => { setOpen(false); router.push('/admin') }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Shield className="w-4 h-4 text-gray-400" />
                Admin Panel
              </button>
            )}
          </div>

          <div className="border-t border-gray-100 py-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
