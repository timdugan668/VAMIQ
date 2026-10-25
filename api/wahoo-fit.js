export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { fit_url } = req.query;
  if (!fit_url) return res.status(400).json({ error: 'Missing fit_url' });

  try {
    const fitRes = await fetch(decodeURIComponent(fit_url));
    if (!fitRes.ok) return res.status(fitRes.status).json({ error: 'FIT fetch failed: ' + fitRes.status });
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
  if (bytes[8] !== 0x2E || bytes[9] !== 0x46 || bytes[10] !== 0x49 || bytes[11] !== 0x54) {
    return { error: 'Not a valid FIT file', latlng, altitude, heartrate, cadence, power, speed };
  }

  let pos = headerSize;
  const dataSize = bytes[4] | (bytes[5]<<8) | (bytes[6]<<16) | (bytes[7]<<24);
  const endPos = headerSize + dataSize;
  const localMsgDefs = {};

  // Developer field definitions: devFieldDefs[devDataIdx][fieldNum] = {size, name}
  // Global msg 206 = field_description: field 0 = dev_data_index (uint8), field 1 = field_def_num (uint8),
  // field 2 = fit_base_type_id (uint8), field 3 = field_name (string), field 4 = units (string)
  const devFieldDefs = {}; // devDataIdx -> {fieldDefNum -> {size, name}}

  while (pos < endPos && pos < bytes.length - 1) {
    const recordHeader = bytes[pos++];

    if (recordHeader & 0x80) {
      // Compressed timestamp data record
      const lt = (recordHeader >> 5) & 0x03;
      const def = localMsgDefs[lt];
      if (!def) continue;
      // Read normal fields
      const msgData = {};
      for (const f of def.fields) {
        if (pos + f.size > bytes.length) break;
        msgData[f.num] = readField(bytes, pos, f.size, def.arch);
        pos += f.size;
      }
      // Read dev fields
      const devData = {};
      for (const df of (def.devFields || [])) {
        if (pos + df.size > bytes.length) break;
        devData[df.devFieldNum] = readField(bytes, pos, df.size, def.arch);
        pos += df.size;
      }
      processRecord(def, msgData, devData, devFieldDefs, latlng, altitude, heartrate, cadence, power, speed);
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const lt = recordHeader & 0x0F;

    if (isDefinition) {
      pos++; // reserved
      const arch = bytes[pos++];
      const gm = arch === 0 ? bytes[pos] | (bytes[pos+1]<<8) : (bytes[pos]<<8) | bytes[pos+1];
      pos += 2;
      const nf = bytes[pos++];
      const fields = [];
      for (let i = 0; i < nf; i++) {
        if (pos + 2 >= bytes.length) break;
        fields.push({ num: bytes[pos++], size: bytes[pos++], type: bytes[pos++] });
      }
      const devFields = [];
      if (recordHeader & 0x20) {
        const ndf = bytes[pos++];
        for (let i = 0; i < ndf; i++) {
          if (pos + 2 >= bytes.length) break;
          const devFieldNum = bytes[pos++];
          const size = bytes[pos++];
          const devDataIdx = bytes[pos++];
          devFields.push({ devFieldNum, size, devDataIdx });
        }
      }
      localMsgDefs[lt] = { globalMsgNum: gm, arch, fields, devFields };

    } else {
      // Normal data record
      const def = localMsgDefs[lt];
      if (!def) continue;
      const msgData = {};
      for (const f of def.fields) {
        if (pos + f.size > bytes.length) break;
        msgData[f.num] = readField(bytes, pos, f.size, def.arch);
        pos += f.size;
      }
      // Read dev fields
      const devData = {};
      for (const df of (def.devFields || [])) {
        if (pos + df.size > bytes.length) break;
        devData[df.devFieldNum] = readField(bytes, pos, df.size, def.arch);
        pos += df.size;
      }

      // Global msg 206 = field_description (developer field definition)
      if (def.globalMsgNum === 206) {
        // field 0 = dev_data_index, field 1 = field_def_num, field 2 = fit_base_type_id, field 3 = field_name
        const devDataIdx = msgData[0];
        const fieldDefNum = msgData[1];
        const baseTypeId = msgData[2];
        // Determine size from base type
        const size = baseTypeSize(baseTypeId);
        if (devDataIdx !== undefined && fieldDefNum !== undefined) {
          if (!devFieldDefs[devDataIdx]) devFieldDefs[devDataIdx] = {};
          devFieldDefs[devDataIdx][fieldDefNum] = { size };
        }
      } else {
        processRecord(def, msgData, devData, devFieldDefs, latlng, altitude, heartrate, cadence, power, speed);
      }
    }
  }

  return { latlng, altitude, heartrate, cadence, power, speed };
}

function processRecord(def, msgData, devData, devFieldDefs, latlng, altitude, heartrate, cadence, power, speed) {
  if (def.globalMsgNum !== 20) return;

  let lat = undefined, lon = undefined;

  // Try standard fields first (field 0=lat, 1=lon)
  if (msgData[0] !== undefined && msgData[1] !== undefined) {
    const latRaw = toSigned32(msgData[0]);
    const lonRaw = toSigned32(msgData[1]);
    if (latRaw !== 0x7FFFFFFF && lonRaw !== 0x7FFFFFFF) {
      lat = latRaw * (180 / 2147483648);
      lon = lonRaw * (180 / 2147483648);
    }
  }

  // Try developer fields for lat/lon (Wahoo stores GPS as dev fields)
  // Check all dev fields in this record - look for sint32 values in valid GPS range
  for (const df of (def.devFields || [])) {
    const val = devData[df.devFieldNum];
    if (val === undefined) continue;
    const signed = toSigned32(val);
    if (signed === 0x7FFFFFFF || signed === -0x80000000) continue;
    const deg = signed * (180 / 2147483648);
    if (lat === undefined && Math.abs(deg) >= 0.001 && Math.abs(deg) <= 90) {
      // Could be latitude
      lat = deg;
    } else if (lon === undefined && Math.abs(deg) >= 0.001 && Math.abs(deg) <= 180) {
      // Could be longitude
      lon = deg;
    }
  }

  if (lat !== undefined && lon !== undefined) {
    if (Math.abs(lat) >= 0.001 && Math.abs(lat) <= 90 &&
        Math.abs(lon) >= 0.001 && Math.abs(lon) <= 180) {
      latlng.push([parseFloat(lat.toFixed(6)), parseFloat(lon.toFixed(6))]);
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

function baseTypeSize(typeId) {
  // FIT base type sizes
  const sizes = {0x00:1,0x01:1,0x02:1,0x83:1,0x84:2,0x85:4,0x86:4,0x87:1,0x88:2,0x89:4,0x8A:1,0x8B:2,0x8C:4,0x8D:4,0x8E:8,0x8F:8,0x07:1};
  return sizes[typeId] || 1;
}

function toSigned32(n) {
  return n > 0x7FFFFFFF ? n - 0x100000000 : n;
}

function readField(bytes, pos, size, arch) {
  if (size === 1) return bytes[pos];
  if (size === 2) return arch === 0
    ? bytes[pos] | (bytes[pos+1]<<8)
    : (bytes[pos]<<8) | bytes[pos+1];
  if (size === 4) return arch === 0
    ? ((bytes[pos]) | (bytes[pos+1]<<8) | (bytes[pos+2]<<16) | (bytes[pos+3]<<24)) >>> 0
    : ((bytes[pos]<<24) | (bytes[pos+1]<<16) | (bytes[pos+2]<<8) | bytes[pos+3]) >>> 0;
  return 0;
}
