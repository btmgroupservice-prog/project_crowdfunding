import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import Login from './pages/Login.jsx'
import GuardCheckin from './pages/GuardCheckin.jsx'
import GuardPatrol from './pages/GuardPatrol.jsx'
import GuardVisitorLog from './pages/GuardVisitorLog.jsx'
import GuardProfile from './pages/GuardProfile.jsx'
import ResidentDashboard from './pages/ResidentDashboard.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import TabBar from './components/TabBar.jsx'

const ROLE_LABEL = { guard: 'รปภ', admin: 'แอดมิน' }
const RESIDENT_SESSION_KEY = 'btm_resident_session'

// ตราสัญลักษณ์รูปโล่ทอง — ล้อกับโลโก้ตราวงกลมสีทองในโบรชัวร์บริษัท BTM Security Guard
function Crest() {
  return (
    <svg className="crest" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="1.1" opacity="0.55" />
      <path
        d="M12 4.5l5.5 2.1v4.3c0 3.9-2.35 6.75-5.5 8.1-3.15-1.35-5.5-4.2-5.5-8.1V6.6L12 4.5z"
        fill="currentColor"
        opacity="0.16"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M9.3 12.1l1.9 1.9 3.6-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ตรวจว่ากำลังเปิดผ่าน "เบราว์เซอร์ในแอปแชท" (LINE, Facebook, Instagram, TikTok, WeChat ฯลฯ) อยู่หรือไม่
// เบราว์เซอร์พวกนี้มักไม่ขอสิทธิ์กล้อง/GPS ให้เว็บไซต์ได้ถูกต้อง ทำให้ "เปิดกล้องถ่ายภาพเข้างาน" ใช้งานไม่ได้
// (เคยเกิดปัญหาจริง: ส่งลิงก์ทางไลน์แล้วเปิดจากในแอปไลน์ตรงๆ กดถ่ายภาพแล้วไม่มีอะไรเกิดขึ้นเลย)
function isInAppBrowser() {
  const ua = navigator.userAgent || ''
  return /Line\//i.test(ua) || /FBAN|FBAV/i.test(ua) || /Instagram/i.test(ua) || /MicroMessenger/i.test(ua) || /TikTok|musical_ly/i.test(ua)
}

function InAppBrowserWarning() {
  if (!isInAppBrowser()) return null
  return (
    <div className="inapp-warning">
      ⚠️ <b>กำลังเปิดผ่านเบราว์เซอร์ในแอปแชท</b> (เช่น LINE) — ถ่ายภาพเข้างาน/ตรวจจุดจะใช้งานไม่ได้ เพราะกล้องขอสิทธิ์ไม่ได้
      <br />
      กรุณากดปุ่มเมนู (⋮ หรือ •••) ที่มุมขวาบน แล้วเลือก <b>&quot;เปิดใน Chrome&quot;</b> หรือ <b>&quot;เปิดใน Safari&quot;</b> ก่อนเข้าใช้งาน
    </div>
  )
}

function loadResidentSession() {
  try {
    const raw = sessionStorage.getItem(RESIDENT_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = ยังไม่รู้, null = ไม่ได้ล็อกอิน
  const [profile, setProfile] = useState(null)
  const [sites, setSites] = useState([])
  const [activeCheckin, setActiveCheckin] = useState(null)
  const [view, setView] = useState('guard-checkin')
  const [viewHistory, setViewHistory] = useState([]) // ใช้กับปุ่ม "กลับ" มุมซ้ายบน — จำหน้าก่อนหน้าของ รปภ ไว้
  const [backSignal, setBackSignal] = useState(0) // ใช้กับปุ่ม "กลับ" ฝั่งแอดมิน/ลูกบ้าน — เพิ่มค่าทุกครั้งที่กด เพื่อบอกให้กลับหน้าเริ่มต้นของตัวเอง
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [residentSession, setResidentSession] = useState(loadResidentSession) // {siteId, siteName, code} | null — ลูกบ้าน/นิติ ไม่ผ่าน Supabase Auth เลย
  const loadedUserIdRef = useRef(null) // เก็บ user id ล่าสุดที่โหลดโปรไฟล์ไปแล้ว ป้องกันไม่ให้รีเซ็ตหน้าจอซ้ำ

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // ดึงรายชื่อหน่วยงาน (สำหรับ รปภ เลือกตอน check-in) — ต้อง login แล้วเท่านั้นถึงอ่านได้ (RLS จำกัดไว้)
  useEffect(() => {
    if (!session) {
      setSites([])
      return
    }
    supabase.from('sites').select('id, name').order('name').then(({ data }) => setSites(data || []))
  }, [session])

  const loadProfileAndRoute = useCallback(async (userId) => {
    setLoadingProfile(true)

    // เพิ่งสมัคร/เพิ่งอ้างสิทธิ์แอดมินด้วย PIN — ตอนนี้ auth session เกิดขึ้นแล้ว แต่แถวข้อมูลใน profiles
    // (ที่เขียนผ่าน insert หรือ RPC claim_admin_role ในหน้า Login) อาจจะยังเขียนไม่เสร็จตอนที่โค้ดจุดนี้ทำงานพอดี
    // (เหตุการณ์ล็อกอินกับการเขียนโปรไฟล์เป็นคนละ request กัน) ถ้าเจอแบบนี้ครั้งแรกจะยังไม่เจอแถว ให้ลองใหม่สั้นๆ
    // ไม่กี่ครั้งก่อนจะสรุปว่าไม่มีโปรไฟล์จริงๆ — กันปัญหา "ไม่พบโปรไฟล์ผู้ใช้" หลอกๆ ตอนสมัคร/อ้างสิทธิ์ครั้งแรก
    let prof = null
    let error = null
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await supabase.from('profiles').select('*').eq('id', userId).single()
      prof = result.data
      error = result.error
      if (prof) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (error || !prof) {
      setProfile(null)
      setLoadingProfile(false)
      return
    }

    // บัญชีเก่าจากก่อนปรับระบบ (role เป็น resident/juristic) ใช้ไม่ได้แล้ว — เปลี่ยนไปใช้รหัสโครงการแทน
    if (prof.role === 'resident' || prof.role === 'juristic') {
      await supabase.auth.signOut()
      setProfile(null)
      setLoadingProfile(false)
      alert('ระบบปรับปรุงใหม่แล้ว — ลูกบ้าน/นิติบุคคล กรุณาเข้าใช้งานด้วย "รหัสโครงการ 6 หลัก" แทนการเข้าสู่ระบบแบบเดิม')
      return
    }

    setProfile(prof)

    if (prof.role === 'guard') {
      const { data: active } = await supabase
        .from('checkins')
        .select('*')
        .eq('guard_id', userId)
        .is('time_out', null)
        .order('time_in', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (active) {
        setActiveCheckin(active)
        setView('guard-patrol')
      } else {
        setActiveCheckin(null)
        setView('guard-checkin')
      }
    }
    setLoadingProfile(false)
  }, [])

  useEffect(() => {
    if (session === undefined) return
    if (session === null) {
      setProfile(null)
      loadedUserIdRef.current = null
      return
    }
    // Supabase จะยิง onAuthStateChange ซ้ำได้เอง (เช่น ตอนสลับแอปกลับมาที่เบราว์เซอร์ หลังขออนุญาตกล้อง/GPS
    // หรือตอนต่ออายุ token อัตโนมัติ) ทั้งที่เป็นคนเดิมคนเดียวกัน — ถ้าไม่กันจุดนี้ไว้ หน้าที่กำลังกรอกข้อมูล/ถ่ายภาพ
    // อยู่จะถูกโหลดใหม่และรีเซ็ตข้อมูลทิ้งหมดทุกครั้งที่เหตุการณ์นี้เกิด จึงโหลดโปรไฟล์ใหม่เฉพาะตอนเปลี่ยนคนจริงๆ เท่านั้น
    if (loadedUserIdRef.current === session.user.id) return
    loadedUserIdRef.current = session.user.id
    loadProfileAndRoute(session.user.id)
  }, [session, loadProfileAndRoute])

  function handleResidentCode({ siteId, siteName, code }) {
    const payload = { siteId, siteName, code }
    try {
      sessionStorage.setItem(RESIDENT_SESSION_KEY, JSON.stringify(payload))
    } catch {
      // ไม่มีสิทธิ์ใช้ sessionStorage (โหมดส่วนตัว ฯลฯ) — ยังใช้งานได้ต่อ แค่ต้องกรอกรหัสใหม่ถ้ารีเฟรชหน้า
    }
    setResidentSession(payload)
  }

  function handleResidentLogout() {
    try {
      sessionStorage.removeItem(RESIDENT_SESSION_KEY)
    } catch {
      // เพิกเฉยได้ ไม่กระทบการทำงาน
    }
    setResidentSession(null)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setProfile(null)
    setActiveCheckin(null)
  }

  function handleCheckinComplete(checkinRow) {
    setActiveCheckin(checkinRow)
    setViewHistory([])
    setView('guard-patrol')
  }

  function handleCheckoutComplete() {
    setActiveCheckin(null)
    setViewHistory([])
    setView('guard-checkin')
  }

  // เปลี่ยนหน้าของ รปภ พร้อมจำหน้าก่อนหน้าไว้ ใช้แทน setView ตรงๆ ทุกจุดที่ผู้ใช้กดเปลี่ยนแท็บเอง
  function navigateGuard(next) {
    setViewHistory((h) => [...h, view])
    setView(next)
  }

  // ปุ่ม "กลับ" มุมซ้ายบน ใช้ร่วมกันทุกหน้า (รปภ / แอดมิน / ลูกบ้าน) — กดผิดหน้าแล้วกลับได้ทันที ไม่ต้องออกจากระบบ
  function handleBack() {
    if (profile?.role === 'guard') {
      setViewHistory((h) => {
        if (h.length === 0) {
          // ไม่มีประวัติแล้ว — กลับไปหน้าเริ่มต้นตามสถานะปัจจุบัน (กำลังเข้าเวรอยู่ = หน้าปฏิบัติหน้าที่, ยังไม่เช็คอิน = หน้าเข้างาน)
          setView(activeCheckin ? 'guard-patrol' : 'guard-checkin')
          return h
        }
        const prev = h[h.length - 1]
        setView(prev)
        return h.slice(0, -1)
      })
    } else {
      // แอดมิน/ลูกบ้าน — หน้าย่อยทั้งหมดสลับกันได้อยู่แล้วจากเมนูในหน้า จึงพากลับไป "หน้าเริ่มต้น" ของตัวเองแทน
      setBackSignal((n) => n + 1)
    }
  }

  // ------- เส้นทางลูกบ้าน/นิติบุคคล (ใช้รหัสโครงการ ไม่ผ่าน Supabase Auth เลย) -------
  if (residentSession) {
    return (
      <div className="shell">
        <InAppBrowserWarning />
        <div className="topbar">
          <div className="topbar-left">
            <button type="button" className="btn-back" onClick={handleBack} title="กลับหน้าเริ่มต้น">◀ กลับ</button>
            <div className="brand"><Crest /> BTM GUARD</div>
          </div>
          <div className="userchip">
            <span>โครงการ: <b>{residentSession.siteName}</b></span>
            <button className="logout" onClick={handleResidentLogout}>ออกจากระบบ</button>
          </div>
        </div>
        <div className="content">
          <ResidentDashboard siteId={residentSession.siteId} siteName={residentSession.siteName} code={residentSession.code} resetSignal={backSignal} />
        </div>
      </div>
    )
  }

  // ------- render (รปภ / แอดมิน — ผ่าน Supabase Auth) -------
  if (session === undefined) {
    return (
      <div className="shell">
        <div className="center-loading">กำลังโหลด...</div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="shell">
        <InAppBrowserWarning />
        <div className="topbar">
          <div className="brand"><Crest /> BTM GUARD</div>
        </div>
        <div className="content">
          <Login onResidentCode={handleResidentCode} />
        </div>
      </div>
    )
  }

  if (loadingProfile || !profile) {
    return (
      <div className="shell">
        <div className="content">
          <div className="center-loading">{loadingProfile ? 'กำลังโหลดข้อมูลผู้ใช้...' : 'ไม่พบโปรไฟล์ผู้ใช้ — ลองออกจากระบบแล้วเข้าใหม่'}</div>
          {!loadingProfile && (
            <button className="btn btn-outline" onClick={handleLogout}>ออกจากระบบ</button>
          )}
        </div>
      </div>
    )
  }

  const isGuard = profile.role === 'guard'
  const isAdmin = profile.role === 'admin'

  return (
    <div className="shell">
      <InAppBrowserWarning />
      <div className="topbar">
        <div className="topbar-left">
          <button type="button" className="btn-back" onClick={handleBack} title="กลับหน้าที่แล้ว/หน้าเริ่มต้น">◀ กลับ</button>
          <div className="brand"><Crest /> BTM GUARD</div>
        </div>
        <div className="userchip">
          <span>สวัสดี, <b>{profile.full_name}</b></span>
          <span className="badge">{ROLE_LABEL[profile.role] || profile.role}</span>
          <button className="logout" onClick={handleLogout}>ออกจากระบบ</button>
        </div>
      </div>

      <div className="content">
        {isGuard && view === 'guard-checkin' && (
          <GuardCheckin sites={sites} profile={profile} onComplete={handleCheckinComplete} />
        )}
        {isGuard && view === 'guard-patrol' && activeCheckin && (
          <GuardPatrol checkin={activeCheckin} onCheckoutComplete={handleCheckoutComplete} />
        )}
        {isGuard && view === 'guard-visitor' && activeCheckin && (
          <GuardVisitorLog checkin={activeCheckin} profile={profile} />
        )}
        {isGuard && view === 'guard-profile' && <GuardProfile profile={profile} />}
        {isAdmin && <AdminDashboard resetSignal={backSignal} />}
      </div>

      {isGuard && (
        <TabBar
          view={view}
          onChange={navigateGuard}
          patrolEnabled={!!activeCheckin}
        />
      )}
    </div>
  )
}
