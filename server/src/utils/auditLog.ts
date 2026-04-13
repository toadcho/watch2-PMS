import prisma from './prisma';

interface AuditLogParams {
  userId: string;
  ipAddress?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT';
  targetType?: string;
  targetId?: bigint | number;
  changeDetail?: any;
}

export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        ipAddress: params.ipAddress || null,
        action: params.action,
        targetType: params.targetType || null,
        targetId: params.targetId ? BigInt(params.targetId) : null,
        changeDetail: params.changeDetail || null,
      },
    });
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}
