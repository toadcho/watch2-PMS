/**
 * 한국 공휴일 + 주말 유틸리티
 * - 양력 법정공휴일 고정
 * - 음력 기반 공휴일(설날, 추석)은 연도별 테이블로 관리
 */

// 양력 고정 공휴일 (MM-DD)
const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
}

// 음력 기반 공휴일 (설날, 추석 등) — 연도별 양력 변환 테이블
// 설날: 음력 1/1 (전날, 당일, 다음날 3일)
// 추석: 음력 8/15 (전날, 당일, 다음날 3일)
// 부처님오신날: 음력 4/8
const LUNAR_HOLIDAYS: Record<number, string[]> = {
  2025: [
    '2025-01-28', '2025-01-29', '2025-01-30', // 설날
    '2025-05-05', // 부처님오신날 (어린이날과 겹침)
    '2025-10-05', '2025-10-06', '2025-10-07', // 추석
  ],
  2026: [
    '2026-02-16', '2026-02-17', '2026-02-18', // 설날
    '2026-05-24', // 부처님오신날
    '2026-09-24', '2026-09-25', '2026-09-26', // 추석
  ],
  2027: [
    '2027-02-05', '2027-02-06', '2027-02-07', // 설날
    '2027-05-13', // 부처님오신날
    '2027-10-13', '2027-10-14', '2027-10-15', // 추석
  ],
  2028: [
    '2028-01-25', '2028-01-26', '2028-01-27', // 설날
    '2028-05-02', // 부처님오신날
    '2028-10-02', '2028-10-03', '2028-10-04', // 추석
  ],
  2029: [
    '2029-02-12', '2029-02-13', '2029-02-14', // 설날
    '2029-05-20', // 부처님오신날
    '2029-09-21', '2029-09-22', '2029-09-23', // 추석
  ],
  2030: [
    '2030-02-02', '2030-02-03', '2030-02-04', // 설날
    '2030-05-09', // 부처님오신날
    '2030-09-11', '2030-09-12', '2030-09-13', // 추석
  ],
}

// 대체공휴일: 공휴일이 주말과 겹치면 다음 평일이 대체공휴일
// 실제 대통령령으로 정해지므로 여기서는 기본 로직만 적용
const SUBSTITUTE_HOLIDAYS: Record<number, string[]> = {
  2025: ['2025-03-03'], // 삼일절 대체
  2026: ['2026-03-02', '2026-06-08', '2026-08-17'], // 삼일절, 현충일, 광복절 대체
  2027: ['2027-10-11'], // 한글날 대체
  2028: ['2028-05-08', '2028-10-05'], // 어린이날, 개천절 대체
}

/** 특정 날짜의 공휴일 이름 반환 (없으면 null) */
export function getHolidayName(dateStr: string): string | null {
  const mmdd = dateStr.substring(5, 10)
  if (FIXED_HOLIDAYS[mmdd]) return FIXED_HOLIDAYS[mmdd]

  const year = parseInt(dateStr.substring(0, 4))
  const lunarDates = LUNAR_HOLIDAYS[year] || []
  if (lunarDates.includes(dateStr)) {
    if (mmdd.startsWith('01') || mmdd.startsWith('02')) return '설날'
    if (mmdd.startsWith('05')) return '부처님오신날'
    if (mmdd.startsWith('09') || mmdd.startsWith('10')) return '추석'
    return '음력공휴일'
  }

  const subDates = SUBSTITUTE_HOLIDAYS[year] || []
  if (subDates.includes(dateStr)) return '대체공휴일'

  return null
}

/** 주말 여부 */
export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = d.getDay()
  return dow === 0 || dow === 6
}

/** 공휴일 여부 */
export function isHoliday(dateStr: string): boolean {
  return getHolidayName(dateStr) !== null
}

/** 비영업일 (주말 또는 공휴일) */
export function isNonWorkingDay(dateStr: string): boolean {
  return isWeekend(dateStr) || isHoliday(dateStr)
}

/** 특정 연도의 모든 공휴일 목록 반환 [{date, name}] */
export function getYearHolidays(year: number): { date: string; name: string }[] {
  const result: { date: string; name: string }[] = []

  // 양력 고정
  for (const [mmdd, name] of Object.entries(FIXED_HOLIDAYS)) {
    result.push({ date: `${year}-${mmdd}`, name })
  }

  // 음력 기반
  const lunarDates = LUNAR_HOLIDAYS[year] || []
  for (const dateStr of lunarDates) {
    const name = getHolidayName(dateStr)
    if (name && !result.find(r => r.date === dateStr)) {
      result.push({ date: dateStr, name })
    }
  }

  // 대체공휴일
  const subDates = SUBSTITUTE_HOLIDAYS[year] || []
  for (const dateStr of subDates) {
    result.push({ date: dateStr, name: '대체공휴일' })
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}

/** 날짜 표시 색상 반환 */
export function getDateColor(dateStr: string): string | null {
  if (isHoliday(dateStr)) return 'error'
  const d = new Date(dateStr + 'T00:00:00')
  if (d.getDay() === 0) return 'error'     // 일요일
  if (d.getDay() === 6) return 'blue'      // 토요일
  return null
}
