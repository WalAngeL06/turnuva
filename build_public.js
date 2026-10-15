const fs = require('fs');

function encryptPhone(plain, pin = '1923') {
  if (!plain) return '';
  const key = String(pin);
  let raw = '';
  for (let i = 0; i < plain.length; i++) {
    raw += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(raw, 'binary').toString('base64');
}

const master = JSON.parse(fs.readFileSync('kayit.json', 'utf8'));

const pub = JSON.parse(JSON.stringify(master));

if (Array.isArray(pub.participants)) {
  pub.participants = pub.participants.map(p => {
    const item = {
      id: p.id,
      name: p.name,
      gender: p.gender,
      check: p.check || false,
      src: p.src || ''
    };
    if (p.phone) {
      item.phone_enc = encryptPhone(p.phone);
    } else if (p.phone_enc) {
      item.phone_enc = p.phone_enc;
    }
    return item;
  });
}

pub.last_updated = new Date().toISOString();

fs.writeFileSync('data/turnuva_public.json', JSON.stringify(pub, null, 1), 'utf8');
console.log('Successfully generated data/turnuva_public.json!');
