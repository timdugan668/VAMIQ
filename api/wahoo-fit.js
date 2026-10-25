export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { fit_url } = req.query;
  if (!fit_url) return res.status(400).json({ error: 'Missing fit_url' });

  try {
    const fitRes = await fetch(decodeURIComponent(fit_url));
    if (!fitRes.ok) return res.status(fitRes.status).json({ error: 'FIT fetch failed: ' + fitRes.status });
    const buffer = await fitRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const headerSize = bytes[0];
    let pos = headerSize;
    const dataSize = bytes[4] | (bytes[5]<<8) | (bytes[6]<<16) | (bytes[7]<<24);
    const endPos = headerSize + dataSize;
    const localMsgDefs = {};
    const log = [];

    // Walk ALL records, log every DEF and first 5 DATA per local type
    const dataCount = {};
    let recNum = 0;

    while (pos < endPos && pos < bytes.length - 1 && recNum < 5000) {
      recNum++;
      const startPos = pos;
      const recordHeader = bytes[pos++];

      if (recordHeader & 0x80) {
        // Compressed timestamp
        const lt = (recordHeader >> 5) & 0x03;
        const def = localMsgDefs[lt];
        if (!def) { log.push({rec:recNum, pos:startPos, type:'COMP_NO_DEF', lt}); continue; }
        let sz = 0; for (const f of def.fields) sz += f.size;
        log.push({rec:recNum, pos:startPos, type:'COMP', lt, gm:def.globalMsgNum, sz});
        pos += sz;
      } else if (recordHeader & 0x40) {
        // Definition
        const lt = recordHeader & 0x0F;
        pos++; // reserved
        const arch = bytes[pos++];
        const gm = arch===0 ? bytes[pos]|(bytes[pos+1]<<8) : (bytes[pos]<<8)|bytes[pos+1];
        pos+=2;
        const nf = bytes[pos++];
        const fields = [];
        let totalSz = 0;
        for (let i=0; i<nf; i++) {
          if (pos+2 >= bytes.length) break;
          const fsz = bytes[pos+1];
          fields.push({num:bytes[pos], size:fsz, type:bytes[pos+2]});
          totalSz += fsz;
          pos+=3;
        }
        // Dev fields
        let devFields = 0;
        if (recordHeader & 0x20) { devFields = bytes[pos++]; pos += devFields*3; }
        localMsgDefs[lt] = {globalMsgNum:gm, arch, fields};
        log.push({rec:recNum, pos:startPos, type:'DEF', lt, gm, nf, totalDataSz:totalSz, devFields, nextPos:pos});
        dataCount[lt] = 0;
      } else {
        // Data
        const lt = recordHeader & 0x0F;
        const def = localMsgDefs[lt];
        if (!def) { log.push({rec:recNum, pos:startPos, type:'DATA_NO_DEF', lt}); continue; }
        let sz = 0; for (const f of def.fields) sz += f.size;
        if ((dataCount[lt] || 0) < 3) {
          const raw = Array.from(bytes.slice(pos, pos+Math.min(sz,16))).map(b=>b.toString(16).padStart(2,'0')).join(' ');
          log.push({rec:recNum, pos:startPos, type:'DATA', lt, gm:def.globalMsgNum, sz, raw});
        }
        dataCount[lt] = (dataCount[lt]||0)+1;
        pos += sz;
      }
    }

    return res.status(200).json({ totalBytes: bytes.length, endPos, recNum, log });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

