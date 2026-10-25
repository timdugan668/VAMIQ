export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { fit_url } = req.query;
  if (!fit_url) return res.status(400).json({ error: 'Missing fit_url' });

  try {
    const fitRes = await fetch(decodeURIComponent(fit_url));
    if (!fitRes.ok) {
      return res.status(fitRes.status).json({ error: 'Failed to fetch FIT file: ' + fitRes.status });
    }
    const buffer = await fitRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Dump raw bytes for diagnosis
    const first40 = Array.from(bytes.slice(0, 40)).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const headerSize = bytes[0];
    const dataSize = bytes[4] | (bytes[5]<<8) | (bytes[6]<<16) | (bytes[7]<<24);
    const sig = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);

    // Read first definition record manually
    let pos = headerSize;
    const h1 = bytes[pos]; pos++;
    const reserved = bytes[pos]; pos++;
    const arch = bytes[pos]; pos++;
    const gm = arch===0 ? bytes[pos]|(bytes[pos+1]<<8) : (bytes[pos]<<8)|bytes[pos+1];
    pos+=2;
    const nf = bytes[pos]; pos++;
    const firstFields = [];
    for (let i=0; i<Math.min(nf,10); i++) {
      firstFields.push({num: bytes[pos], size: bytes[pos+1], type: bytes[pos+2]});
      pos+=3;
    }

    return res.status(200).json({
      _raw: {
        first40hex: first40,
        headerSize,
        dataSize,
        totalBytes: bytes.length,
        sig,
        firstDefHeader: '0x'+h1.toString(16),
        firstDefArch: arch,
        firstDefGlobalMsg: gm,
        firstDefNumFields: nf,
        firstDefFields: firstFields,
        bytes14to20: Array.from(bytes.slice(14, 22)).map(b => b.toString(16).padStart(2,'0')).join(' ')
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
