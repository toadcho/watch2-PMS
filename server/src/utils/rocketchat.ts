/**
 * Rocket.Chat REST API 클라이언트
 * - PMS 이벤트 연동: 사용자 생성, 채널 관리, 메시지 발송
 * - 모든 호출은 best-effort (RC 장애 시 PMS 기능에 영향 없음)
 */

const RC_URL = process.env.ROCKETCHAT_URL || 'http://localhost:3200';
const RC_ADMIN_USER = process.env.ROCKETCHAT_ADMIN_USER || 'pmsadmin';
const RC_ADMIN_PASSWORD = process.env.ROCKETCHAT_ADMIN_PASSWORD || '';
const RC_PUBLIC_URL = process.env.ROCKETCHAT_PUBLIC_URL || 'http://localhost:3200';

let adminToken: string | null = null;
let adminUserId: string | null = null;

async function ensureAdminAuth(): Promise<{ authToken: string; userId: string } | null> {
  if (adminToken && adminUserId) return { authToken: adminToken, userId: adminUserId };
  try {
    const res = await fetch(`${RC_URL}/api/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: RC_ADMIN_USER, password: RC_ADMIN_PASSWORD }),
    });
    const data = await res.json();
    if (data.status === 'success') {
      adminToken = data.data.authToken;
      adminUserId = data.data.userId;
      console.log('RC: Admin authenticated');
      return { authToken: adminToken!, userId: adminUserId! };
    }
    console.error('RC: Admin login failed:', data.message);
    return null;
  } catch (err) {
    console.error('RC: Connection failed:', (err as Error).message);
    return null;
  }
}

async function rcApi(method: string, endpoint: string, body?: any): Promise<any> {
  const auth = await ensureAdminAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`${RC_URL}/api/v1${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': auth.authToken,
        'X-User-Id': auth.userId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    // Token expired — retry once
    if (res.status === 401) {
      adminToken = null;
      adminUserId = null;
      const retryAuth = await ensureAdminAuth();
      if (!retryAuth) return null;
      const retryRes = await fetch(`${RC_URL}/api/v1${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': retryAuth.authToken,
          'X-User-Id': retryAuth.userId,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return await retryRes.json();
    }
    return data;
  } catch (err) {
    console.error(`RC API error [${method} ${endpoint}]:`, (err as Error).message);
    return null;
  }
}

// ════════════════════════════════════════════════════════
//  사용자 관리
// ════════════════════════════════════════════════════════

export async function createRcUser(params: { username: string; name: string; email: string; password: string }): Promise<any> {
  // RC 이메일은 항상 고유하게 userId@pms.local 사용
  const rcEmail = `${params.username}@pms.local`;
  const data = await rcApi('POST', '/users.create', {
    username: params.username,
    name: params.name,
    email: rcEmail,
    password: params.password,
    verified: true,
    joinDefaultChannels: false,
  });
  if (data?.success) {
    console.log(`RC: User created — ${params.username}`);
    return data.user;
  }
  // 이미 존재하면 조회하여 반환
  if (data?.error?.includes('already in use') || data?.errorType === 'error-field-unavailable') {
    const existing = await getRcUserByUsername(params.username);
    if (existing) return existing;
  }
  console.error(`RC: User create failed — ${params.username}:`, data?.error || data?.message);
  return null;
}

export async function updateRcUser(rcUserId: string, params: { name?: string; password?: string }): Promise<boolean> {
  const updateData: any = { userId: rcUserId };
  if (params.name) updateData.data = { ...updateData.data, name: params.name };
  if (params.password) updateData.data = { ...updateData.data, password: params.password };
  const data = await rcApi('POST', '/users.update', updateData);
  return data?.success || false;
}

export async function setRcUserActive(rcUserId: string, active: boolean): Promise<boolean> {
  const data = await rcApi('POST', '/users.update', {
    userId: rcUserId,
    data: { active },
  });
  return data?.success || false;
}

export async function deleteRcUser(rcUserId: string): Promise<boolean> {
  const data = await rcApi('POST', '/users.delete', { userId: rcUserId });
  return data?.success || false;
}

export async function getRcUserByUsername(username: string): Promise<any> {
  const data = await rcApi('GET', `/users.info?username=${encodeURIComponent(username)}`);
  return data?.success ? data.user : null;
}

// ════════════════════════════════════════════════════════
//  채널 관리
// ════════════════════════════════════════════════════════

export async function createChannel(name: string, memberUsernames: string[]): Promise<any> {
  // 채널명: 소문자, 공백→하이픈, 특수문자 제거
  const safeName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣_-]/g, '');
  const data = await rcApi('POST', '/channels.create', {
    name: safeName,
    members: memberUsernames,
    readOnly: false,
  });
  if (data?.success) {
    console.log(`RC: Channel created — ${safeName}`);
    return data.channel;
  }
  // 이미 존재하면 조회
  if (data?.errorType === 'error-duplicate-channel-name') {
    const existing = await getChannelByName(safeName);
    if (existing) return existing;
  }
  console.error(`RC: Channel create failed — ${safeName}:`, data?.error || data?.message);
  return null;
}

export async function addMemberToChannel(channelId: string, rcUserId: string): Promise<boolean> {
  const data = await rcApi('POST', '/channels.invite', { roomId: channelId, userId: rcUserId });
  return data?.success || false;
}

export async function renameChannel(channelId: string, newName: string): Promise<boolean> {
  const safeName = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣_-]/g, '');
  const data = await rcApi('POST', '/channels.rename', { roomId: channelId, name: safeName });
  if (data?.success) return true;
  // private 채널인 경우
  const dataPrivate = await rcApi('POST', '/groups.rename', { roomId: channelId, name: safeName });
  return dataPrivate?.success || false;
}

export async function removeMemberFromChannel(channelId: string, rcUserId: string): Promise<boolean> {
  const data = await rcApi('POST', '/channels.kick', { roomId: channelId, userId: rcUserId });
  return data?.success || false;
}

export async function archiveChannel(channelId: string): Promise<boolean> {
  const data = await rcApi('POST', '/channels.archive', { roomId: channelId });
  return data?.success || false;
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  const data = await rcApi('POST', '/channels.delete', { roomId: channelId });
  if (data?.success) return true;
  // private 채널일 수 있음
  const dataPrivate = await rcApi('POST', '/groups.delete', { roomId: channelId });
  return dataPrivate?.success || false;
}

export async function getChannelByName(name: string): Promise<any> {
  const data = await rcApi('GET', `/channels.info?roomName=${encodeURIComponent(name)}`);
  return data?.success ? data.channel : null;
}

// ════════════════════════════════════════════════════════
//  메시지 발송
// ════════════════════════════════════════════════════════

export async function sendChannelMessage(channelId: string, text: string, alias?: string): Promise<boolean> {
  const msg: any = { rid: channelId, msg: text };
  if (alias) msg.alias = alias;
  const data = await rcApi('POST', '/chat.sendMessage', { message: msg });
  return data?.success || false;
}

export async function sendDirectMessage(toUsername: string, text: string): Promise<boolean> {
  // DM 채널 생성/조회
  const dmData = await rcApi('POST', '/dm.create', { username: toUsername });
  if (!dmData?.success) {
    console.error(`RC DM create failed for ${toUsername}:`, dmData?.error || dmData?.message || 'no response');
    return false;
  }
  const rid = dmData.room._id || dmData.room.rid;
  const msg = { rid, msg: `**📢 PMS 알림**\n${text}` };
  const data = await rcApi('POST', '/chat.sendMessage', { message: msg });
  if (!data?.success) {
    console.error(`RC DM send failed for ${toUsername}:`, data?.error || data?.message || 'no response');
    return false;
  }
  console.log(`RC DM sent to ${toUsername}`);
  return true;
}

// ════════════════════════════════════════════════════════
//  테마/브랜딩 설정
// ════════════════════════════════════════════════════════

/**
 * RC 전역 테마 색상 설정 (서버 전체에 적용)
 * @param primaryColor HEX 색상 (예: '#1976D2')
 * @param siteName 워크스페이스 이름
 */
export async function updateRcBranding(params: { primaryColor?: string; headerColor?: string; siteName?: string }): Promise<void> {
  const updates: Array<{ key: string; value: string }> = [];

  if (params.siteName) {
    updates.push({ key: 'Site_Name', value: params.siteName });
  }

  if (params.primaryColor) {
    const primary = params.primaryColor;
    const header = params.headerColor || primary;
    const css = `
:root {
  --rcx-color-button-background-primary-default: ${primary};
  --rcx-color-button-background-primary-hover: ${primary};
  --rcx-color-button-background-primary-press: ${primary};
  --rcx-color-badge-background-level-2: ${primary};
  --rcx-color-stroke-highlight: ${primary};
  --rcx-color-status-font-on-info: ${primary};
  --rcx-color-surface-neutral: ${primary}1a;
}
.rcx-sidebar { background-color: ${header} !important; }
`;
    updates.push({ key: 'theme-custom-css', value: css });
  }

  for (const u of updates) {
    await rcApi('POST', `/settings/${u.key}`, { value: u.value });
  }

  if (updates.length > 0) {
    console.log(`RC: Branding updated (${updates.length} settings)`);
  }
}

// ════════════════════════════════════════════════════════
//  연결 상태 확인
// ════════════════════════════════════════════════════════

export function getRcPublicUrl(): string {
  return RC_PUBLIC_URL;
}

/**
 * RC Site_Name을 삭제될 프로젝트명이 포함된 경우만 기본값으로 초기화
 */
export async function resetRcSiteName(deletedProjectName: string): Promise<void> {
  const current = await rcApi('GET', '/settings/Site_Name');
  if (current?.value && typeof current.value === 'string' && current.value.includes(deletedProjectName)) {
    await rcApi('POST', '/settings/Site_Name', { value: 'PMS 메신저' });
    console.log('RC: Site_Name reset to default');
  }
}

export async function isRcAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${RC_URL}/api/info`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.version;
  } catch { return false; }
}
