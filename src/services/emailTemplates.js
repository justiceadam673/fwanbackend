const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function layout({ title, intro, buttonText, link, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f3f7f2;font-family:Arial,Helvetica,sans-serif;color:#1f2d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#2e7d32;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">FWAN</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>
<p style="line-height:1.5;margin:0 0 20px">${intro}</p>
<p style="margin:0 0 20px"><a href="${esc(link)}" style="background:#2e7d32;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:bold">${esc(buttonText)}</a></p>
<p style="font-size:12px;color:#556;line-height:1.5;margin:0 0 8px">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="font-size:12px;color:#556;margin:0">${footer}</p></td></tr></table></td></tr></table></body></html>`;
}

export function verifyEmail({ name, link }) {
  return {
    subject: "Verify your FWAN email address",
    text: `Hello ${name},\n\nWelcome to FWAN. Please verify your email address by opening this link:\n${link}\n\nThe link expires in 24 hours. If you did not create an account, ignore this email.`,
    html: layout({ title: "Verify your email address", intro: `Hello ${esc(name)}, welcome to FWAN. Please confirm your email address to activate your account.`, buttonText: "Verify my email", link, footer: "This link expires in 24 hours. If you did not create an account, you can ignore this email." }),
  };
}

export function resetPassword({ name, link }) {
  return {
    subject: "Reset your FWAN password",
    text: `Hello ${name},\n\nReset your password using this link:\n${link}\n\nThe link expires in 1 hour. If you did not ask for this, ignore this email.`,
    html: layout({ title: "Reset your password", intro: `Hello ${esc(name)}, we received a request to reset your FWAN password.`, buttonText: "Choose a new password", link, footer: "This link expires in 1 hour. If you did not request it, ignore this email and your password stays the same." }),
  };
}

// Small standalone result pages served by the backend, so email links work even before the front end has its own pages.
export function resultPage({ ok, title, message, continueUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f7f2;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:420px;margin:16px;background:#fff;border-radius:12px;padding:28px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<div style="font-size:42px">${ok ? "&#9989;" : "&#9888;&#65039;"}</div><h2 style="margin:8px 0">${esc(title)}</h2>
<p style="color:#445;line-height:1.5">${esc(message)}</p>
<a href="${esc(continueUrl)}" style="display:inline-block;margin-top:12px;background:#2e7d32;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Continue to FWAN</a></div></body></html>`;
}

export function resetFormPage({ token, apiPath, continueUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset password</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f7f2;font-family:Arial,Helvetica,sans-serif">
<div style="width:100%;max-width:380px;margin:16px;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<h2 style="margin-top:0">Choose a new password</h2>
<input id="pw" type="password" placeholder="New password (8+ characters, letters and numbers)" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #bbb;border-radius:8px;margin-bottom:12px">
<button id="go" style="width:100%;padding:12px;background:#2e7d32;color:#fff;border:0;border-radius:8px;font-weight:bold;cursor:pointer">Change password</button>
<p id="msg" style="color:#445;min-height:20px"></p><a id="next" href="${esc(continueUrl)}" style="display:none">Continue to FWAN</a></div>
<script>
document.getElementById('go').onclick=async()=>{const m=document.getElementById('msg');m.textContent='Please wait...';
try{const r=await fetch(${JSON.stringify(apiPath)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)},password:document.getElementById('pw').value})});
const j=await r.json();if(r.ok){m.textContent=j.message;document.getElementById('next').style.display='inline';}else{m.textContent=(j.error&&(j.error.details&&j.error.details.password?'Password '+j.error.details.password:j.error.message))||'Failed';}}
catch(e){m.textContent='Cannot reach the server.';}};
</script></body></html>`;
}
