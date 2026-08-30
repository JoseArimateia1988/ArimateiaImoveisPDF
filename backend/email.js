const EMAIL_FROM = process.env.EMAIL_FROM || 'Busca Certa <onboarding@resend.dev>';

export function emailReady() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY não configurada — e-mail não enviado:', subject, 'para', to);
    return { skipped: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Falha ao enviar e-mail (${r.status}): ${body}`);
  }
  return r.json();
}

function layout(title, bodyHtml) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f0ebe4;font-family:Georgia,'Times New Roman',serif;color:#1f2924;padding:32px 16px">
<div style="max-width:480px;margin:0 auto;background:#fffdf8;border-radius:14px;overflow:hidden;border:1px solid #ddd2c3">
  <div style="background:#152b22;color:#fbf6ee;padding:20px 28px"><span style="font-size:18px">Busca Certa</span></div>
  <div style="padding:28px">
    <h1 style="font-size:20px;margin:0 0 12px;color:#152b22">${title}</h1>
    ${bodyHtml}
  </div>
  <div style="padding:16px 28px;color:#8a8f89;font-size:11px;font-family:Inter,system-ui,sans-serif">Busca Certa · seleções personalizadas de imóveis</div>
</div>
</body></html>`;
}

export function redefinirSenhaEmail({ resetUrl }) {
  return layout('Redefinir sua senha', `
    <p style="font-size:14px;line-height:1.6;font-family:Inter,system-ui,sans-serif">Recebemos um pedido para redefinir a senha da sua conta no Busca Certa. Este é o e-mail que você usa pra entrar e recuperar acesso à conta.</p>
    <a href="${resetUrl}" style="display:inline-block;margin-top:16px;background:#c66b3f;color:#fff;padding:12px 22px;border-radius:9px;text-decoration:none;font-family:Inter,system-ui,sans-serif;font-weight:700;font-size:13px">Criar nova senha</a>
    <p style="font-size:11px;color:#8a8f89;margin-top:20px;font-family:Inter,system-ui,sans-serif">Este link expira em 1 hora. Se você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.</p>
  `);
}
