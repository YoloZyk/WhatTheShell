/** 复制文本到剪贴板 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const clipboardy = await import('clipboardy');
    await clipboardy.default.write(text);
    return true;
  } catch {
    return false;
  }
}
