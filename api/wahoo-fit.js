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
    const records = parseFIT(bytes);
    return res.status(200).json(records);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function parseFIT(bytes) {
  const latlng = [], altitude = [], heartrate = [], cadence = [], power = [], speed = [];

  const headerSize = bytes[0];
  if (headerSize < 12) return { latlng, altitude, heartrate, cadence, power, speed, _d: 'bad header size: ' + headerSize };

  const sig = [bytes[8], bytes[9], bytes[10], bytes[11]];
  if (sig[0] !== 0x2E || sig[1] !== 0x46 || sig[2] !== 0x49 || sig[3] !== 0x54) {
    return { error: 'Not a valid FIT file', sig, latlng, altitude, heartrate, cadence, power, speed };
  }

  let pos = headerSize;
  const dataSize = bytes[4] | (bytes[5]<<8) | (bytes[6]<<16) | (bytes[7]<<24);
  const endPos = headerSize + dataSize;
  const localMsgDefs = {};

  // Debug: track first 50 record headers and what definitions we build
  const debugHeaders = [];
  const debugDefs = {};
  let totalRecords = 0;
  let gpsRecords = 0;

  function processRecord(def, msgData) {
    if (def.globalMsgNum !== 20) return;
    gpsRecords++;
    if (msgData[0] !== undefined && msgData[1] !== undefined) {
      const latRaw = toSigned32(msgData[0]);
      const lonRaw = toSigned32(msgData[1]);
      if (latRaw !== 0x7FFFFFFF && lonRaw !== 0x7FFFFFFF) {
        const lat = latRaw * (180 / 2147483648);
        const lon = lonRaw * (180 / 2147483648);
        if (Math.abs(lat) >= 0.001 && Math.abs(lat) <= 90 &&
            Math.abs(lon) >= 0.001 && Math.abs(lon) <= 180) {
          latlng.push([parseFloat(lat.toFixed(6)), parseFloat(lon.toFixed(6))]);
        } else {
          // Log bad GPS values for debugging
          if (gpsRecords <= 3) debugHeaders.push({badGps: true, latRaw, lonRaw, lat, lon});
        }
      }
    }
    if (msgData[2] !== undefined && msgData[2] !== 0xFFFF)
      altitude.push(parseFloat((msgData[2] / 5 - 500).toFixed(1)));
    if (msgData[3] !== undefined && msgData[3] !== 0xFF) heartrate.push(msgData[3]);
    if (msgData[4] !== undefined && msgData[4] !== 0xFF) cadence.push(msgData[4]);
    if (msgData[6] !== undefined && msgData[6] !== 0xFFFF)
      speed.push(parseFloat((msgData[6] * 0.0036).toFixed(1)));
    if (msgData[7] !== undefined && msgData[7] !== 0xFFFF) power.push(msgData[7]);
  }

  while (pos < endPos && pos < bytes.length - 1) {
    const recordHeader = bytes[pos++];
    totalRecords++;

    if (totalRecords <= 50) {
      debugHeaders.push({ n: totalRecords, pos: pos-1, h: '0x'+recordHeader.toString(16), type: recordHeader&0x80 ? 'COMP' : (recordHeader&0x40 ? 'DEF' : 'DATA') });
    }

    // Bit 7 = compressed timestamp record
    if (recordHeader & 0x80) {
      const localMsgType = (recordHeader >> 5) & 0x03;
      const def = localMsgDefs[localMsgType];
      if (!def) continue;
      const msgData = {};
      for (const field of def.fields) {
        if (pos + field.size > bytes.length) break;
        msgData[field.num] = readField(bytes, pos, field.size, def.arch);
        pos += field.size;
      }
      processRecord(def, msgData);
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const localMsgType = recordHeader & 0x0F;

    if (isDefinition) {
      pos++; // reserved byte
      const arch = bytes[pos++];
      const globalMsgNum = arch === 0
        ? bytes[pos] | (bytes[pos+1] << 8)
        : (bytes[pos] << 8) | bytes[pos+1];
      pos += 2;
      const numFields = bytes[pos++];
      const fields = [];
      for (let i = 0; i < numFields; i++) {
        if (pos + 2 >= bytes.length) break;
        fields.push({ num: bytes[pos++], size: bytes[pos++], type: bytes[pos++] });
      }
      localMsgDefs[localMsgType] = { globalMsgNum, arch, fields };
      debugDefs[localMsgType] = { globalMsgNum, numFields, fieldSizes: fields.map(f=>f.size) };
      // Developer fields
      if (recordHeader & 0x20) {
        if (pos < bytes.length) {
          const numDevFields = bytes[pos++];
          pos += numDevFields * 3;
        }
      }
    } else {
      const def = localMsgDefs[localMsgType];
      if (!def) continue;
      const msgData = {};
      for (const field of def.fields) {
        if (pos + field.size > bytes.length) break;
        msgData[field.num] = readField(bytes, pos, field.size, def.arch);
        pos += field.size;
      }
      processRecord(def, msgData);
    }
  }

  return {
    latlng, altitude, heartrate, cadence, power, speed,
    _debug: { totalBytes: bytes.length, totalRecords, gpsRecords, latlngFound: latlng.length, defs: debugDefs, firstHeaders: debugHeaders.slice(0,30) }
  };
}

function toSigned32(n) {
  return n > 0x7FFFFFFF ? n - 0x100000000 : n;
}

function readField(bytes, pos, size, arch) {
  if (size === 1) return bytes[pos];
  if (size === 2) return arch === 0
    ? bytes[pos] | (bytes[pos+1] << 8)
    : (bytes[pos] << 8) | bytes[pos+1];
  if (size === 4) return arch === 0
    ? ((bytes[pos]) | (bytes[pos+1]<<8) | (bytes[pos+2]<<16) | (bytes[pos+3]<<24)) >>> 0
    : ((bytes[pos]<<24) | (bytes[pos+1]<<16) | (bytes[pos+2]<<8) | bytes[pos+3]) >>> 0;
  return 0;
}
