// Parse FIT file from Wahoo CDN and extract GPS + data streams
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { fit_url, access_token } = req.query;
  if (!fit_url || !access_token) return res.status(400).json({ error: 'Missing fit_url or access_token' });

  try {
    // Fetch the FIT file from Wahoo CDN
    const fitRes = await fetch(fit_url, {
      headers: { 'Authorization': 'Bearer ' + access_token }
    });

    if (!fitRes.ok) {
      return res.status(fitRes.status).json({ error: 'Failed to fetch FIT file' });
    }

    const buffer = await fitRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Parse FIT file - extract GPS records
    // FIT binary format: header + records
    const records = parseFIT(bytes);

    return res.status(200).json(records);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function parseFIT(bytes) {
  const latlng = [];
  const altitude = [];
  const heartrate = [];
  const cadence = [];
  const power = [];
  const speed = [];

  // FIT file header is 12 or 14 bytes
  let pos = 0;
  const headerSize = bytes[0];
  if (headerSize < 12) return { latlng, altitude, heartrate, cadence, power, speed };

  // Check FIT signature
  if (bytes[8] !== 0x2E || bytes[9] !== 0x46 || bytes[10] !== 0x49 || bytes[11] !== 0x54) {
    return { error: 'Not a valid FIT file', latlng, altitude, heartrate, cadence, power, speed };
  }

  pos = headerSize;
  const dataSize = readUint32(bytes, 4);
  const endPos = headerSize + dataSize;

  const localMsgDefs = {};

  while (pos < endPos - 1) {
    const recordHeader = bytes[pos];
    pos++;

    // Normal header
    const isDefinition = (recordHeader & 0x40) !== 0;
    const localMsgType = recordHeader & 0x0F;

    if (isDefinition) {
      // Definition message
      pos++; // reserved
      const arch = bytes[pos++]; // architecture (0=little, 1=big)
      const globalMsgNum = arch === 0
        ? bytes[pos] | (bytes[pos+1] << 8)
        : (bytes[pos] << 8) | bytes[pos+1];
      pos += 2;
      const numFields = bytes[pos++];
      const fields = [];
      for (let i = 0; i < numFields; i++) {
        fields.push({ num: bytes[pos++], size: bytes[pos++], type: bytes[pos++] });
      }
      localMsgDefs[localMsgType] = { globalMsgNum, arch, fields };
      // Skip developer fields if present
      if (recordHeader & 0x20) {
        const numDevFields = bytes[pos++];
        pos += numDevFields * 3;
      }
    } else {
      // Data message
      const def = localMsgDefs[localMsgType];
      if (!def) { pos++; continue; }

      const msgData = {};
      for (const field of def.fields) {
        const val = readField(bytes, pos, field.size, field.type, def.arch);
        msgData[field.num] = val;
        pos += field.size;
      }

      // Global message 20 = record (GPS data point)
      if (def.globalMsgNum === 20) {
        // Field 0=lat, 1=lon, 2=altitude, 3=heartrate, 4=cadence, 6=speed, 7=power
        if (msgData[0] !== undefined && msgData[1] !== undefined) {
          const lat = msgData[0] * (180 / Math.pow(2, 31));
          const lon = msgData[1] * (180 / Math.pow(2, 31));
          if (lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            latlng.push([lat, lon]);
          }
        }
        if (msgData[2] !== undefined && msgData[2] < 65535) {
          altitude.push(msgData[2] / 5 - 500); // FIT altitude scaling
        }
        if (msgData[3] !== undefined && msgData[3] < 255) heartrate.push(msgData[3]);
        if (msgData[4] !== undefined && msgData[4] < 255) cadence.push(msgData[4]);
        if (msgData[7] !== undefined && msgData[7] < 65535) power.push(msgData[7]);
        if (msgData[6] !== undefined && msgData[6] < 65535) speed.push(msgData[6] / 1000 * 3.6); // m/s to km/h
      }
    }
  }

  return { latlng, altitude, heartrate, cadence, power, speed };
}

function readUint32(bytes, pos) {
  return bytes[pos] | (bytes[pos+1]<<8) | (bytes[pos+2]<<16) | (bytes[pos+3]<<24);
}

function readField(bytes, pos, size, baseType, arch) {
  if (size === 1) return bytes[pos];
  if (size === 2) return arch === 0
    ? bytes[pos] | (bytes[pos+1] << 8)
    : (bytes[pos] << 8) | bytes[pos+1];
  if (size === 4) return arch === 0
    ? bytes[pos] | (bytes[pos+1]<<8) | (bytes[pos+2]<<16) | (bytes[pos+3]<<24)
    : (bytes[pos]<<24) | (bytes[pos+1]<<16) | (bytes[pos+2]<<8) | bytes[pos+3];
  return 0;
}

