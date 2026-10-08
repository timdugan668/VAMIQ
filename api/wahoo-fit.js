export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { fit_url } = req.query;
  if (!fit_url) return res.status(400).json({ error: 'Missing fit_url' });

  try {
    // Wahoo CDN files are publicly accessible
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
  if (headerSize < 12) return { latlng, altitude, heartrate, cadence, power, speed };

  // Check .FIT signature
  if (bytes[8] !== 0x2E || bytes[9] !== 0x46 || bytes[10] !== 0x49 || bytes[11] !== 0x54) {
    return { error: 'Not a valid FIT file', latlng, altitude, heartrate, cadence, power, speed };
  }

  let pos = headerSize;
  const dataSize = bytes[4] | (bytes[5]<<8) | (bytes[6]<<16) | (bytes[7]<<24);
  const endPos = headerSize + dataSize;
  const localMsgDefs = {};

  while (pos < endPos - 1) {
    if (pos >= bytes.length - 1) break;
    const recordHeader = bytes[pos++];
    const isDefinition = (recordHeader & 0x40) !== 0;
    const localMsgType = recordHeader & 0x0F;

    if (isDefinition) {
      pos++; // reserved
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
      if (recordHeader & 0x20) {
        if (pos < bytes.length) {
          const numDevFields = bytes[pos++];
          pos += numDevFields * 3;
        }
      }
    } else {
      const def = localMsgDefs[localMsgType];
      if (!def) { pos++; continue; }

      const msgData = {};
      for (const field of def.fields) {
        if (pos + field.size > bytes.length) break;
        msgData[field.num] = readField(bytes, pos, field.size, def.arch);
        pos += field.size;
      }

      // Global message 20 = GPS record
      if (def.globalMsgNum === 20) {
        if (msgData[0] !== undefined && msgData[1] !== undefined) {
          const lat = msgData[0] * (180 / 2147483648);
          const lon = msgData[1] * (180 / 2147483648);
          if (Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            latlng.push([parseFloat(lat.toFixed(6)), parseFloat(lon.toFixed(6))]);
          }
        }
        if (msgData[2] !== undefined && msgData[2] < 0xFFFF) altitude.push(parseFloat((msgData[2] / 5 - 500).toFixed(1)));
        if (msgData[3] !== undefined && msgData[3] < 255) heartrate.push(msgData[3]);
        if (msgData[4] !== undefined && msgData[4] < 255) cadence.push(msgData[4]);
        if (msgData[7] !== undefined && msgData[7] < 0xFFFF) power.push(msgData[7]);
        if (msgData[6] !== undefined && msgData[6] < 0xFFFF) speed.push(parseFloat((msgData[6] * 0.0036).toFixed(1)));
      }
    }
  }

  return { latlng, altitude, heartrate, cadence, power, speed };
}

function readField(bytes, pos, size, arch) {
  if (size === 1) return bytes[pos];
  if (size === 2) return arch === 0 ? bytes[pos] | (bytes[pos+1]<<8) : (bytes[pos]<<8) | bytes[pos+1];
  if (size === 4) {
    const v = arch === 0
      ? bytes[pos] | (bytes[pos+1]<<8) | (bytes[pos+2]<<16) | (bytes[pos+3]<<24)
      : (bytes[pos]<<24) | (bytes[pos+1]<<16) | (bytes[pos+2]<<8) | bytes[pos+3];
    return v >>> 0; // unsigned
  }
  return 0;
}
