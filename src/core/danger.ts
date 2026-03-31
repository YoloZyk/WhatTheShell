import type { RiskLevel } from '../types';

interface DangerRule {
  pattern: RegExp;
  level: RiskLevel;
  message_zh: string;
  message_en: string;
}

/** 危险命令规则库 */
const DANGER_RULES: DangerRule[] = [
  // 高危：可能导致数据不可恢复
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+.*\/|.*-rf\s|.*--no-preserve-root)/, level: 'danger', message_zh: '递归强制删除文件，可能导致数据不可恢复', message_en: 'Recursive force delete, may cause irreversible data loss' },
  { pattern: /\brm\s+-[a-zA-Z]*r/, level: 'danger', message_zh: '递归删除文件，请确认目标路径', message_en: 'Recursive delete, verify target path' },
  { pattern: /\bmkfs\b/, level: 'danger', message_zh: '格式化磁盘，将擦除所有数据', message_en: 'Format disk, all data will be erased' },
  { pattern: /\bdd\b.*\bof=/, level: 'danger', message_zh: 'dd 直接写入设备/文件，可能覆盖重要数据', message_en: 'dd writes directly to device/file, may overwrite critical data' },
  { pattern: />\s*\/dev\/sd[a-z]/, level: 'danger', message_zh: '直接写入磁盘设备，将破坏分区数据', message_en: 'Writing directly to disk device, will destroy partition data' },
  { pattern: /:()\{\s*:\|:&\s*\};:/, level: 'danger', message_zh: 'Fork bomb，将耗尽系统资源', message_en: 'Fork bomb, will exhaust system resources' },
  { pattern: /\bchmod\s+(-[a-zA-Z]*\s+)?777\s+\//, level: 'danger', message_zh: '对根目录设置 777 权限，严重安全风险', message_en: 'Setting 777 on root directory, critical security risk' },
  { pattern: /\bchown\s+(-[a-zA-Z]*R[a-zA-Z]*\s+).*\s+\/\s*$/, level: 'danger', message_zh: '递归更改根目录所有权', message_en: 'Recursively changing root directory ownership' },

  // 中等风险：需注意
  { pattern: /\bsudo\b/, level: 'warning', message_zh: '使用 sudo 提权执行，请确认命令安全', message_en: 'Running with sudo privileges, verify command safety' },
  { pattern: /\bkill\s+-9\b/, level: 'warning', message_zh: '强制终止进程，进程无法进行清理操作', message_en: 'Force kill process, no cleanup will be performed' },
  { pattern: /\bkillall\b/, level: 'warning', message_zh: '批量终止进程，请确认目标进程', message_en: 'Killing all matching processes, verify target' },
  { pattern: /\bchmod\s+(-[a-zA-Z]*\s+)?777\b/, level: 'warning', message_zh: '设置 777 权限，所有用户可读写执行', message_en: 'Setting 777 permissions, all users can read/write/execute' },
  { pattern: />\s*\/dev\/null\s*2>&1/, level: 'warning', message_zh: '丢弃所有输出，可能错过重要错误信息', message_en: 'Discarding all output, may miss important errors' },
  { pattern: /\bsystemctl\s+(stop|disable|restart)\b/, level: 'warning', message_zh: '操作系统服务，可能影响系统运行', message_en: 'Operating system service, may affect system stability' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/, level: 'warning', message_zh: '将关机或重启系统', message_en: 'Will shutdown or reboot the system' },
  { pattern: /\bcurl\b.*\|\s*(bash|sh|zsh)\b/, level: 'warning', message_zh: '从网络下载并直接执行脚本，存在安全风险', message_en: 'Downloading and executing script from network, security risk' },
  { pattern: /\bwget\b.*&&.*\b(bash|sh|zsh)\b/, level: 'warning', message_zh: '从网络下载并执行脚本，存在安全风险', message_en: 'Downloading and executing script from network, security risk' },
  { pattern: /\b>\s+[^|&\s]+\s*$/, level: 'warning', message_zh: '重定向覆盖文件，原内容将丢失', message_en: 'Redirecting to file, original content will be lost' },
];

export interface DangerCheckResult {
  risk: RiskLevel;
  warnings: string[];
}

/** 检测命令的危险等级 */
export function checkDanger(command: string, language: 'zh' | 'en' = 'zh'): DangerCheckResult {
  let highestRisk: RiskLevel = 'safe';
  const warnings: string[] = [];

  for (const rule of DANGER_RULES) {
    if (rule.pattern.test(command)) {
      const msg = language === 'zh' ? rule.message_zh : rule.message_en;

      if (rule.level === 'danger') {
        highestRisk = 'danger';
        warnings.push(msg);
      } else if (rule.level === 'warning' && highestRisk !== 'danger') {
        highestRisk = 'warning';
        warnings.push(msg);
      }
    }
  }

  return { risk: highestRisk, warnings };
}
