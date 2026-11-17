export function downloadText(text: string, filename: string, type='text/markdown;charset=utf-8'): void {
 const url=URL.createObjectURL(new Blob([text],{type}));
 const anchor=document.createElement('a');
 try { anchor.href=url; anchor.download=filename.replace(/[^\p{L}\p{N}._-]/gu,'_'); document.body.append(anchor); anchor.click(); }
 finally { anchor.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
}
export async function copyText(text: string): Promise<void> {
 if (!navigator.clipboard?.writeText) throw new Error('Копирование недоступно. Скачайте Markdown или выделите текст материала вручную.');
 try { await navigator.clipboard.writeText(text); } catch { throw new Error('Браузер запретил копирование. Скачайте Markdown или выделите текст вручную.'); }
}
